import io
import logging
import os
import re
import sys
import time
import json
from typing import Dict, List, Optional, Tuple

from PIL import Image
from google import genai
from google.genai import types

from app.models.schemas import (
    DetectionResult,
    GroupedPhotos,
    PhotoInfo,
    ProcessingStatus,
)

# Configure logger for this module
logger = logging.getLogger(__name__)


class NumberDetector:
    def __init__(self):
        self.results: Dict[str, DetectionResult] = {}
        self.gemini_client = None
        self.use_gemini = None  # Will be determined on first use
        self._file_cache: Dict[str, str] = {}  # Cache: photo_id -> local_file_path

    def _initialize_gemini_client(self):
        """Initialize Gemini client lazily when first needed"""
        if self.use_gemini is not None:
            return  # Already initialized

        try:
            # Get Gemini API key from settings configuration
            from app.core.config import settings
            
            api_key = settings.gemini_api_key
            if api_key:
                self.gemini_client = genai.Client(api_key=api_key)
                self.use_gemini = True
                logger.info("✅ Gemini 2.0 Flash API initialized successfully")
            else:
                # No API key available
                self.gemini_client = None
                self.use_gemini = False
                logger.error("❌ No Gemini API key available - classification will fail")
        except Exception as e:
            logger.error(f"❌ Gemini API initialization failed: {e}")
            self.gemini_client = None
            self.use_gemini = False

    async def process_photo_batch(
        self, photo_ids: List[str], debug_mode: bool = False, user_id: Optional[int] = None
    ) -> Dict[str, DetectionResult]:
        """
        Concurrent Processing for Speed with Bounded Gemini Calls.
        Processes photos in parallel but with individual Gemini calls for maximum accuracy.
        Uses semaphore to limit concurrent API calls and prevent rate limiting.
        """
        if not photo_ids:
            return {}

        batch_start_time = time.time()
        self._initialize_gemini_client()
        
        if not self.use_gemini:
            logger.error("Cannot process batch: Gemini is not configured.")
            return {photo_id: DetectionResult(bib_number="unknown", bbox=None) 
                   for photo_id in photo_ids}

        # Tunable concurrency limit via environment variable
        import asyncio
        concurrency = int(os.getenv("GEMINI_CONCURRENCY", "2"))  # Default: 2 for balanced throughput
        semaphore = asyncio.Semaphore(concurrency)
        
        logger.info(f"🚀 CONCURRENT PROCESSING: Starting {len(photo_ids)} photos with concurrency={concurrency}")
        
        results = {}

        async def process_single_photo(idx: int, photo_id: str) -> None:
            """Process a single photo with semaphore-controlled concurrency."""
            async with semaphore:
                photo_start_time = time.time()
                
                try:
                    logger.info(f"📸 [{idx+1}/{len(photo_ids)}] Processing {photo_id[:8]}...")
                    
                    # T1: File path resolution and potential GCS download
                    t1_start = time.time()
                    photo_path = self._find_photo_path(photo_id, user_id)
                    t1_duration = (time.time() - t1_start) * 1000  # Convert to milliseconds
                    
                    if not photo_path:
                        logger.warning(f"❌ [{photo_id[:8]}] Photo file not found")
                        results[photo_id] = DetectionResult(bib_number="unknown", bbox=None)
                        return

                    # T2: Image optimization and preprocessing
                    t2_start = time.time()
                    image_data, img_shape = self._optimize_image_for_gemini(photo_path, debug_mode)
                    t2_duration = (time.time() - t2_start) * 1000
                    if not image_data:
                        logger.warning(f"❌ [{photo_id[:8]}] Failed to optimize image")
                        results[photo_id] = DetectionResult(bib_number="unknown", bbox=None)
                        return
                    
                    # REFINED PROMPT: Focus on Digit Integrity over Count
                    single_prompt = """Act as an elite sports photography OCR specialist. 
Extract the race number from the handlebar plate or bib.

Rules for 99.9% Accuracy:
1. **Digit Integrity**: Only extract shapes that are clearly printed digits. 
2. **Noise Rejection**: Ignore red/white background graphics, triangles, or logos on the plate. These are NOT digits.
3. **Cable Check**: If a cable crosses the number, reconstruct the digit from top/bottom segments.
4. **No Forced Count**: Do not guess extra digits. If you only see one digit (e.g., '7'), return only that digit.

Return JSON:
{
  "plate_description": "description of plate color/position", 
  "digit_count": int,
  "number": "string",
  "reasoning": "Explain why shapes were identified as digits or rejected as graphics"
}"""

                    content = [
                        types.Part.from_bytes(data=image_data, mime_type="image/jpeg"),
                        single_prompt
                    ]

                    # T3: Gemini API call
                    t3_start = time.time()
                    logger.info(f"🤖 [{photo_id[:8]}] Calling Gemini with Digit Integrity prompt...")
                    response = await self.gemini_client.aio.models.generate_content(
                        model="gemini-2.0-flash",
                        contents=content,
                        config=types.GenerateContentConfig(response_mime_type="application/json")
                    )
                    t3_duration = (time.time() - t3_start) * 1000

                    if not response or not response.text:
                        logger.error(f"❌ [{photo_id[:8]}] Empty Gemini response")
                        results[photo_id] = DetectionResult(bib_number="unknown", bbox=None)
                        return

                    # T4: JSON parsing and postprocessing
                    t4_start = time.time()
                    try:
                        clean_text = response.text.strip()
                        if clean_text.startswith("```json"):
                            clean_text = clean_text.split("```json")[1].split("```")[0].strip()
                        elif clean_text.startswith("```"):
                            clean_text = clean_text.split("```")[1].split("```")[0].strip()
                        
                        res_json = json.loads(clean_text)
                        
                        # Handle both array and object responses from Gemini
                        if isinstance(res_json, list):
                            if len(res_json) == 0:
                                logger.error(f"❌ EMPTY ARRAY [{photo_id[:8]}]: Gemini returned empty array")
                                results[photo_id] = DetectionResult(bib_number="unknown", bbox=None)
                                return
                            # Take the first element from array
                            res_json = res_json[0]
                            logger.debug(f"🔧 ARRAY HANDLING [{photo_id[:8]}]: Extracted first element from array response")
                        elif not isinstance(res_json, dict):
                            logger.error(f"❌ INVALID FORMAT [{photo_id[:8]}]: Expected dict or list, got {type(res_json)} - {clean_text[:100]}...")
                            results[photo_id] = DetectionResult(bib_number="unknown", bbox=None)
                            return
                        
                        # Extract and validate fields
                        detected_bib = str(res_json.get("number", "")).strip()
                        plate_description = res_json.get("plate_description", "No description")
                        digit_count = res_json.get("digit_count", 0)
                        reasoning = res_json.get("reasoning", "No reasoning provided")
                        
                        # Enhanced logging with reasoning
                        logger.info(f"🔍 PLATE [{photo_id[:8]}]: {plate_description}")
                        logger.info(f"🔢 REASONING [{photo_id[:8]}]: {reasoning}")
                        logger.info(f"📊 DIGITS [{photo_id[:8]}]: Detected '{detected_bib}' ({digit_count} digit{'s' if digit_count != 1 else ''})")
                        
                        # Validate detected bib number
                        if not detected_bib or detected_bib.upper() in ["NONE", "NULL", "UNKNOWN", ""]:
                            logger.info(f"❌ EMPTY [{photo_id[:8]}]: No number detected - {reasoning}")
                            results[photo_id] = DetectionResult(bib_number="unknown", bbox=None)
                        elif not self._is_valid_bib_number(detected_bib):
                            logger.info(f"❌ INVALID [{photo_id[:8]}]: '{detected_bib}' failed validation - {reasoning}")
                            results[photo_id] = DetectionResult(bib_number="unknown", bbox=None)

                            
                            # Create center-focused bounding box
                            bbox = [
                                int(img_shape[1] * 0.25), int(img_shape[0] * 0.3), 
                                int(img_shape[1] * 0.75), int(img_shape[0] * 0.7)
                            ]
                            
                            results[photo_id] = DetectionResult(
                                bib_number=detected_bib,
                                bbox=bbox
                            )
                            self.results[photo_id] = results[photo_id]  # Store in cache
                        
                        # Complete T4 timing
                        t4_duration = (time.time() - t4_start) * 1000
                        
                        # Log comprehensive timing breakdown
                        total_duration = t1_duration + t2_duration + t3_duration + t4_duration
                        logger.info(f"⏱️ TIMING [{photo_id[:8]}]: T1={t1_duration:.0f}ms T2={t2_duration:.0f}ms T3={t3_duration:.0f}ms T4={t4_duration:.0f}ms TOTAL={total_duration:.0f}ms")
                        
                        photo_time = time.time() - photo_start_time
                        if detected_bib and detected_bib not in ["unknown", "error"]:
                            logger.info(f"✅ SUCCESS [{photo_id[:8]}]: '{detected_bib}' in {photo_time:.2f}s")
                        else:
                            logger.info(f"❌ NO DETECTION [{photo_id[:8]}] in {photo_time:.2f}s")

                    except json.JSONDecodeError as e:
                        t4_duration = (time.time() - t4_start) * 1000
                        total_duration = t1_duration + t2_duration + t3_duration + t4_duration
                        logger.error(f"❌ JSON ERROR [{photo_id[:8]}]: {e} - Response: {response.text[:200]}...")
                        logger.info(f"⏱️ TIMING [{photo_id[:8]}]: T1={t1_duration:.0f}ms T2={t2_duration:.0f}ms T3={t3_duration:.0f}ms T4={t4_duration:.0f}ms TOTAL={total_duration:.0f}ms")
                        results[photo_id] = DetectionResult(bib_number="unknown", bbox=None)
                    except KeyError as e:
                        t4_duration = (time.time() - t4_start) * 1000
                        total_duration = t1_duration + t2_duration + t3_duration + t4_duration
                        logger.error(f"❌ MISSING FIELD [{photo_id[:8]}]: {e} - Response: {response.text[:200]}...")
                        logger.info(f"⏱️ TIMING [{photo_id[:8]}]: T1={t1_duration:.0f}ms T2={t2_duration:.0f}ms T3={t3_duration:.0f}ms T4={t4_duration:.0f}ms TOTAL={total_duration:.0f}ms")
                        results[photo_id] = DetectionResult(bib_number="unknown", bbox=None)

                except Exception as e:
                    # Handle timing for general errors (calculate what we can)
                    try:
                        t4_duration = (time.time() - t4_start) * 1000 if 't4_start' in locals() else 0
                        total_duration = t1_duration + t2_duration + t3_duration + t4_duration
                        logger.info(f"⏱️ TIMING [{photo_id[:8]}]: T1={t1_duration:.0f}ms T2={t2_duration:.0f}ms T3={t3_duration:.0f}ms T4={t4_duration:.0f}ms TOTAL={total_duration:.0f}ms")
                    except:
                        pass  # Don't let timing errors mask the original error
                    
                    logger.error(f"❌ PROCESSING ERROR [{photo_id[:8]}]: {e}")
                    results[photo_id] = DetectionResult(bib_number="unknown", bbox=None)

        # Process all photos concurrently with bounded parallelism
        await asyncio.gather(*(process_single_photo(i, photo_id) for i, photo_id in enumerate(photo_ids)))

        # Final summary
        total_time = time.time() - batch_start_time
        successful_count = len([r for r in results.values() if r.bib_number not in ["unknown", "error"]])
        success_rate = (successful_count / len(photo_ids)) * 100 if photo_ids else 0
        
        # DEBUG: Log detailed results before return
        logger.info(f"🔍 DEBUG DETECTOR: results type={type(results)}, len={len(results)}")
        if results:
            logger.info(f"🔍 DEBUG DETECTOR: keys={list(results.keys())[:3]}")
            for photo_id, result in list(results.items())[:2]:  # Log first 2 results
                logger.info(f"🔍 DEBUG DETECTOR: {photo_id[:8]} -> bib='{result.bib_number}', conf={getattr(result, 'confidence', 'NO_CONF')}")
        
        logger.info(f"🎯 CONCURRENT COMPLETE: {successful_count}/{len(photo_ids)} detected ({success_rate:.1f}% success) in {total_time:.2f}s")
        logger.info(f"📁 CACHE STATUS: {len(self._file_cache)} files cached in memory")
        
        return results




    def _optimize_image_for_gemini(
        self, image_path: str, debug_mode: bool = False
    ) -> Tuple[bytes, Tuple[int, int]]:
        """Optimize image for Gemini with configurable compression for faster processing"""
        try:
            # Environment-controlled optimization settings
            max_dim = int(os.getenv("GEMINI_MAX_DIM", "1536"))  # Default: 1536px max dimension
            jpeg_quality = int(os.getenv("GEMINI_JPEG_QUALITY", "90"))  # Default: 90% quality
            enable_compression = os.getenv("GEMINI_ENABLE_COMPRESSION", "true").lower() == "true"
            
            with Image.open(image_path) as img:
                # Convert to RGB for JPEG compatibility
                if img.mode != 'RGB':
                    img = img.convert('RGB')
                
                original_size = img.size
                original_width, original_height = original_size
                
                if not enable_compression:
                    # Raw mode for maximum accuracy (A/B testing)
                    with open(image_path, "rb") as f:
                        original_data = f.read()
                    if debug_mode:
                        logger.info(f"📷 RAW MODE: {original_width}x{original_height} ({len(original_data)/1024:.0f}KB) - NO COMPRESSION")
                    return original_data, (original_height, original_width)
                
                # OCR-optimized preprocessing
                width, height = img.size
                
                # Crop bottom 5% to remove watermarks while preserving handlebar plates  
                crop_height = int(height * 0.95)  # Keep top 95%
                img = img.crop((0, 0, width, crop_height))
                
                # Smart resize: only if larger than max_dim
                new_size = img.size
                if max(img.size) > max_dim:
                    # Calculate new dimensions maintaining aspect ratio
                    if width > height:
                        new_width = max_dim
                        new_height = int((height * max_dim) / width)
                    else:
                        new_height = max_dim
                        new_width = int((width * max_dim) / height)
                    
                    img = img.resize((new_width, new_height), Image.Resampling.LANCZOS)
                    new_size = (new_width, new_height)
                
                # High-quality JPEG compression optimized for OCR
                buffer = io.BytesIO()
                img.save(
                    buffer, 
                    format="JPEG", 
                    quality=jpeg_quality,
                    optimize=True,  # Better compression
                    subsampling=0   # No chroma subsampling for text clarity
                )
                optimized_data = buffer.getvalue()
                
                if debug_mode:
                    original_kb = len(open(image_path, "rb").read()) / 1024
                    optimized_kb = len(optimized_data) / 1024
                    compression_ratio = (1 - optimized_kb / original_kb) * 100
                    logger.info(f"📷 OPTIMIZED: {original_size}→{new_size} | {original_kb:.0f}KB→{optimized_kb:.0f}KB ({compression_ratio:.0f}% smaller) | Q={jpeg_quality}")
                
                # Return optimized data with original dimensions for bbox calculations
                return optimized_data, (original_height, original_width)
                
        except Exception as e:
            logger.error(f"Image optimization failed: {e}, using original")
            # Fallback to original image
            with open(image_path, "rb") as f:
                original_data = f.read()
            
            # Get original dimensions as fallback
            try:
                with Image.open(image_path) as img:
                    width, height = img.size
                return original_data, (height, width)
            except:
                return original_data, (1, 1)


    def _is_valid_bib_number(self, text: str) -> bool:
        if len(text) < 1 or len(text) > 6:
            return False

        if not re.match(r"^\d+$", text):
            return False

        number = int(text)
        return 1 <= number <= 99999


    def _find_photo_path(
        self, photo_id: str, user_id: Optional[int] = None
    ) -> Optional[str]:
        """
        Find photo path with strict user isolation and caching.
        Supports both local storage and Google Cloud Storage.
        SECURITY: Never falls back to shared directories - only user-specific paths.
        """
        extensions = [".jpg", ".jpeg", ".png", ".tiff", ".bmp"]

        # SECURITY REQUIREMENT: user_id is mandatory for multi-tenant safety
        if not user_id:
            logger.error(
                f"Security: user_id required for photo access - photo_id: {photo_id}"
            )
            return None

        # Check cache first
        if photo_id in self._file_cache:
            cached_path = self._file_cache[photo_id]
            if os.path.exists(cached_path):
                logger.debug(f"📁 CACHE HIT: {photo_id[:8]} -> {os.path.basename(cached_path)}")
                return cached_path
            else:
                # Remove stale cache entry
                del self._file_cache[photo_id]
                logger.debug(f"📁 CACHE MISS: {photo_id[:8]} (file deleted)")

        # First try local storage
        user_upload_dir = os.path.join("uploads", str(user_id))
        for ext in extensions:
            local_path = os.path.join(user_upload_dir, f"{photo_id}{ext}")
            if os.path.exists(local_path):
                # Cache the successful local path
                self._file_cache[photo_id] = local_path
                logger.debug(f"📁 LOCAL FOUND: {photo_id[:8]} -> {os.path.basename(local_path)}")
                return local_path

        # If not found locally, try to download from GCS
        try:
            from google.cloud import storage
            from app.core.config import settings
            
            if settings.bucket_name:
                storage_client = storage.Client()
                bucket = storage_client.bucket(settings.bucket_name)
                
                for ext in extensions:
                    filename = f"{photo_id}{ext}"
                    blob_path = f"{user_id}/{filename}"
                    blob = bucket.blob(blob_path)
                    
                    if blob.exists():
                        # Download to local temp file
                        os.makedirs(user_upload_dir, exist_ok=True)
                        local_path = os.path.join(user_upload_dir, filename)
                        blob.download_to_filename(local_path)
                        
                        # Cache the successful download
                        self._file_cache[photo_id] = local_path
                        logger.info(f"📥 GCS DOWNLOAD: {photo_id[:8]} -> {filename} (cached)")
                        return local_path
        except Exception as e:
            logger.debug(f"Could not download from GCS: {e}")

        logger.warning(
            f"Photo not found in local or GCS storage: {photo_id} for user {user_id}"
        )
        return None

    async def get_grouped_results(
        self, photo_ids: List[str], user_id: Optional[int] = None
    ) -> List[GroupedPhotos]:
        groups: Dict[str, List[PhotoInfo]] = {}

        for photo_id in photo_ids:
            result = self.results.get(photo_id)
            photo_path = self._find_photo_path(photo_id, user_id)

            photo_info = PhotoInfo(
                id=photo_id,
                filename=(
                    os.path.basename(photo_path) if photo_path else f"{photo_id}.jpg"
                ),
                original_path=photo_path or "",
                detection_result=result,
                status=(
                    ProcessingStatus.COMPLETED if result else ProcessingStatus.FAILED
                ),
            )

            bib_number = (
                result.bib_number if result and result.bib_number else "unknown"
            )

            if bib_number not in groups:
                groups[bib_number] = []

            groups[bib_number].append(photo_info)

        return [
            GroupedPhotos(bib_number=bib_number, photos=photos, count=len(photos))
            for bib_number, photos in groups.items()
        ]

    def update_manual_label(self, photo_id: str, bib_number: str) -> bool:
        """Update a photo's detection result with a manual label"""
        try:
            # Handle "unknown" labels specially
            if bib_number.lower() == "unknown":
                # For unknown labels, keep them as unknown
                manual_result = DetectionResult(
                    bib_number="unknown",
                    bbox=None,
                )
            else:
                # Create a manual detection result with high confidence for valid bib numbers
                manual_result = DetectionResult(
                    bib_number=bib_number,
                    bbox=None,  # No bounding box for manual labels
                )

            # Store the manual result
            self.results[photo_id] = manual_result
            return True

        except Exception as e:
            logger.error(f"❌ Failed to manually label photo {photo_id}: {e}")
            return False
