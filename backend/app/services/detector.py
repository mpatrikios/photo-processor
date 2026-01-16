import asyncio
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

# Singleton GCS client for connection reuse (avoids 150-200ms overhead per download)
_gcs_client = None

def get_gcs_client():
    """Lazy-initialize and return singleton GCS client."""
    global _gcs_client
    if _gcs_client is None:
        from google.cloud import storage
        _gcs_client = storage.Client()
        logger.info("✅ GCS client singleton initialized")
    return _gcs_client


class NumberDetector:
    def __init__(self):
        self.results: Dict[str, DetectionResult] = {}
        self.gemini_client = None
        self.use_gemini = None  # Will be determined on first use

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
        Concurrent Processing with Parallel Prefetching.
        1. Downloads all images from GCS in parallel
        2. Then fires concurrent Gemini API calls (1 photo per prompt for accuracy)
        """
        if not photo_ids:
            return {}

        batch_start_time = time.time()
        self._initialize_gemini_client()

        if not self.use_gemini:
            logger.error("Cannot process batch: Gemini is not configured.")
            return {photo_id: DetectionResult(bib_number="unknown", confidence=0.0, bbox=None)
                   for photo_id in photo_ids}

        logger.info(f"🚀 CONCURRENT PROCESSING: Starting {len(photo_ids)} photos")

        # PREFETCH: Download all images in parallel before Gemini calls
        prefetch_start = time.time()
        image_cache = await self._prefetch_all_images(photo_ids, user_id, debug_mode)
        prefetch_time = time.time() - prefetch_start
        cached_count = len([v for v in image_cache.values() if v[0] is not None])
        logger.info(f"📥 PREFETCH COMPLETE: {cached_count}/{len(photo_ids)} images cached in {prefetch_time:.2f}s")

        # Concurrency limit to respect Gemini rate limits
        CONCURRENCY_LIMIT = 20
        semaphore = asyncio.Semaphore(CONCURRENCY_LIMIT)

        async def process_with_semaphore(photo_id: str, index: int) -> Tuple[str, DetectionResult]:
            async with semaphore:
                result = await self._process_single_photo_cached(
                    photo_id, index, len(photo_ids), image_cache
                )
                return photo_id, result

        # Fire all Gemini requests concurrently (images already cached)
        tasks = [process_with_semaphore(pid, i) for i, pid in enumerate(photo_ids)]
        results_list = await asyncio.gather(*tasks, return_exceptions=True)

        # Convert results to dict, handling any exceptions
        results = {}
        for item in results_list:
            if isinstance(item, Exception):
                logger.error(f"❌ Task exception: {item}")
                continue
            photo_id, detection_result = item
            results[photo_id] = detection_result
            if detection_result.bib_number not in ["unknown", "error"]:
                self.results[photo_id] = detection_result  # Store in cache

        # Final summary
        total_time = time.time() - batch_start_time
        successful_count = len([r for r in results.values() if r.bib_number not in ["unknown", "error"]])
        success_rate = (successful_count / len(photo_ids)) * 100 if photo_ids else 0
        avg_time = total_time / len(photo_ids) if photo_ids else 0

        logger.info(f"🎯 CONCURRENT COMPLETE: {successful_count}/{len(photo_ids)} detected ({success_rate:.1f}% success) in {total_time:.2f}s ({avg_time:.2f}s/photo effective)")

        return results

    async def _prefetch_all_images(
        self, photo_ids: List[str], user_id: Optional[int], debug_mode: bool
    ) -> Dict[str, Tuple[Optional[bytes], Tuple[int, int]]]:
        """Download all images from GCS in parallel before processing."""
        logger.info(f"📥 PREFETCH: Downloading {len(photo_ids)} images in parallel...")

        async def fetch_one(photo_id: str) -> Tuple[str, Tuple[Optional[bytes], Tuple[int, int]]]:
            try:
                photo_path = await asyncio.to_thread(self._find_photo_path, photo_id, user_id)
                if not photo_path:
                    logger.warning(f"❌ [{photo_id[:8]}] Photo not found during prefetch")
                    return photo_id, (None, (1, 1))

                image_data, img_shape = await asyncio.to_thread(
                    self._optimize_image_for_gemini, photo_path, debug_mode
                )
                return photo_id, (image_data, img_shape)
            except Exception as e:
                logger.error(f"❌ [{photo_id[:8]}] Prefetch error: {e}")
                return photo_id, (None, (1, 1))

        tasks = [fetch_one(pid) for pid in photo_ids]
        results = await asyncio.gather(*tasks)
        return dict(results)

    async def _process_single_photo_cached(
        self, photo_id: str, index: int, total: int,
        image_cache: Dict[str, Tuple[Optional[bytes], Tuple[int, int]]]
    ) -> DetectionResult:
        """Process a single photo using pre-cached image data (no I/O)."""
        photo_start_time = time.time()

        try:
            logger.info(f"📸 [{index+1}/{total}] Processing {photo_id[:8]}... (cached)")

            # ⏱️ TIMING: Cache retrieval
            cache_start = time.time()
            image_data, img_shape = image_cache.get(photo_id, (None, (1, 1)))
            cache_time = (time.time() - cache_start) * 1000

            if not image_data:
                logger.warning(f"❌ [{photo_id[:8]}] No cached image data")
                return DetectionResult(bib_number="unknown", confidence=0.0, bbox=None)

            logger.info(f"⏱️ [{photo_id[:8]}] Cache retrieval: {cache_time:.1f}ms, Image size: {len(image_data)/1024:.0f}KB")

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
  "number": "string",
  "confidence": "high/medium/low",
  "reasoning": "Brief explanation of digit identification"
}"""

            content = [
                types.Part.from_bytes(data=image_data, mime_type="image/jpeg"),
                single_prompt
            ]

            # ⏱️ TIMING: Gemini API call with exponential backoff retry
            import random
            api_start = time.time()
            response = None
            max_retries = 3
            base_delay = 0.5  # seconds (reduced from 1.0 for faster retries)

            for attempt in range(max_retries):
                try:
                    response = await self.gemini_client.aio.models.generate_content(
                        model="gemini-2.0-flash",
                        contents=content,
                        config=types.GenerateContentConfig(response_mime_type="application/json")
                    )
                    if response and response.text:
                        break  # Success
                    logger.warning(f"⚠️ [{photo_id[:8]}] Empty response, attempt {attempt+1}/{max_retries}")
                except Exception as e:
                    error_str = str(e).lower()
                    if "429" in error_str or "rate" in error_str or "quota" in error_str or "resource_exhausted" in error_str:
                        # Exponential backoff with jitter: 0.5-1s, 1-1.5s, 2-2.5s
                        delay = base_delay * (2 ** attempt) + random.uniform(0, 0.5)
                        logger.warning(f"⚠️ [{photo_id[:8]}] Rate limited, retry {attempt+1}/{max_retries} after {delay:.1f}s")
                        await asyncio.sleep(delay)
                    else:
                        logger.error(f"❌ [{photo_id[:8]}] Gemini error: {e}")
                        raise

            api_time = (time.time() - api_start) * 1000
            logger.info(f"⏱️ [{photo_id[:8]}] Gemini API call: {api_time:.0f}ms")

            if not response or not response.text:
                logger.error(f"❌ [{photo_id[:8]}] Empty Gemini response after {max_retries} attempts")
                return DetectionResult(bib_number="unknown", confidence=0.0, bbox=None)

            # ⏱️ TIMING: Parse response
            parse_start = time.time()
            result = self._parse_gemini_response(response.text, photo_id, img_shape, photo_start_time)
            parse_time = (time.time() - parse_start) * 1000

            total_time = (time.time() - photo_start_time) * 1000
            logger.info(f"⏱️ [{photo_id[:8]}] TOTAL: {total_time:.0f}ms (API: {api_time:.0f}ms, Parse: {parse_time:.1f}ms)")

            return result

        except Exception as e:
            logger.error(f"❌ PROCESSING ERROR [{photo_id[:8]}]: {e}")
            return DetectionResult(bib_number="unknown", confidence=0.0, bbox=None)

    def _parse_gemini_response(
        self, response_text: str, photo_id: str, img_shape: Tuple[int, int], start_time: float
    ) -> DetectionResult:
        """Parse Gemini JSON response and return DetectionResult."""
        try:
            clean_text = response_text.strip()
            if clean_text.startswith("```json"):
                clean_text = clean_text.split("```json")[1].split("```")[0].strip()
            elif clean_text.startswith("```"):
                clean_text = clean_text.split("```")[1].split("```")[0].strip()

            res_json = json.loads(clean_text)

            # Handle both array and object responses from Gemini
            if isinstance(res_json, list):
                if len(res_json) == 0:
                    logger.error(f"❌ EMPTY ARRAY [{photo_id[:8]}]: Gemini returned empty array")
                    return DetectionResult(bib_number="unknown", confidence=0.0, bbox=None)
                res_json = res_json[0]
            elif not isinstance(res_json, dict):
                logger.error(f"❌ INVALID FORMAT [{photo_id[:8]}]: Expected dict or list, got {type(res_json)}")
                return DetectionResult(bib_number="unknown", confidence=0.0, bbox=None)

            # Extract and validate fields
            detected_bib = str(res_json.get("number", "")).strip()
            confidence_text = res_json.get("confidence", "low")
            reasoning = res_json.get("reasoning", "")

            # Validate detected bib number
            if not detected_bib or detected_bib.upper() in ["NONE", "NULL", "UNKNOWN", ""]:
                logger.info(f"❌ EMPTY [{photo_id[:8]}]: No number detected - {reasoning}")
                return DetectionResult(bib_number="unknown", confidence=0.0, bbox=None)
            elif not self._is_valid_bib_number(detected_bib):
                logger.info(f"❌ INVALID [{photo_id[:8]}]: '{detected_bib}' failed validation")
                return DetectionResult(bib_number="unknown", confidence=0.0, bbox=None)

            # Convert text confidence to numeric
            confidence_map = {"high": 0.95, "medium": 0.75, "low": 0.5}
            numeric_confidence = confidence_map.get(confidence_text.lower(), 0.5)

            # Create center-focused bounding box
            bbox = [
                int(img_shape[1] * 0.25), int(img_shape[0] * 0.3),
                int(img_shape[1] * 0.75), int(img_shape[0] * 0.7)
            ]

            photo_time = time.time() - start_time
            logger.info(f"✅ SUCCESS [{photo_id[:8]}] ({confidence_text}): '{detected_bib}' in {photo_time:.2f}s")

            return DetectionResult(
                bib_number=detected_bib,
                confidence=numeric_confidence,
                bbox=bbox
            )

        except json.JSONDecodeError as e:
            logger.error(f"❌ JSON ERROR [{photo_id[:8]}]: {e}")
            return DetectionResult(bib_number="unknown", confidence=0.0, bbox=None)
        except KeyError as e:
            logger.error(f"❌ MISSING FIELD [{photo_id[:8]}]: {e}")
            return DetectionResult(bib_number="unknown", confidence=0.0, bbox=None)



    def _resize_image(self, image_bytes: bytes, max_size: int = 1024) -> bytes:
        """
        Resizes image in memory with OCR-optimized settings.
        Higher quality and resolution for better text recognition.
        """
        try:
            with Image.open(io.BytesIO(image_bytes)) as img:
                # Convert to RGB to handle PNGs/CMYK
                if img.mode != 'RGB':
                    img = img.convert('RGB')
                
                original_size = img.size
                
                # Crop bottom 5% to remove watermarks while preserving handlebar plates  
                width, height = img.size
                crop_height = int(height * 0.95)  # Keep top 95%
                img = img.crop((0, 0, width, crop_height))
                
                # Only resize if larger than max_size
                if max(img.size) > max_size:
                    img.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)
                    
                    if logger.isEnabledFor(logging.DEBUG):
                        new_size = img.size
                        reduction = ((original_size[0] * original_size[1]) - (new_size[0] * new_size[1])) / (original_size[0] * original_size[1]) * 100
                        logger.debug(f"🏎️ OCR Resize: {original_size} → {new_size} ({reduction:.0f}% smaller, watermark cropped)")
                
                # OCR-optimized compression settings
                buffer = io.BytesIO()
                img.save(buffer, format="JPEG", quality=85, optimize=True)
                return buffer.getvalue()
                
        except Exception as e:
            logger.warning(f"⚠️ PIL resize failed: {e}, using original")
            return image_bytes  # Fallback to original

    def _optimize_image_for_gemini(
        self, image_path: str, debug_mode: bool = False
    ) -> Tuple[bytes, Tuple[int, int]]:
        """Resize images to 1536px max for faster Gemini processing"""
        try:
            # Read raw image data once
            with open(image_path, "rb") as f:
                original_data = f.read()

            # Get dimensions from bytes (no second file open)
            with Image.open(io.BytesIO(original_data)) as img:
                original_width, original_height = img.size

            # Resize to 1024px max for faster upload and processing
            resized_data = self._resize_image(original_data, max_size=1024)

            if debug_mode:
                logger.info(f"📷 IMAGE: {original_width}x{original_height} ({len(original_data)/1024:.0f}KB) → resized ({len(resized_data)/1024:.0f}KB)")

            return resized_data, (original_height, original_width)

        except Exception as e:
            logger.error(f"Image optimization failed: {e}")
            return None, (1, 1)


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
        Find photo path with strict user isolation.
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

        # First try local storage
        user_upload_dir = os.path.join("uploads", str(user_id))
        for ext in extensions:
            local_path = os.path.join(user_upload_dir, f"{photo_id}{ext}")
            if os.path.exists(local_path):
                return local_path

        # If not found locally, try to download from GCS
        try:
            from app.core.config import settings

            if settings.bucket_name:
                storage_client = get_gcs_client()  # Singleton - avoids 150ms overhead per call
                bucket = storage_client.bucket(settings.bucket_name)
                
                for ext in extensions:
                    filename = f"{photo_id}{ext}"
                    blob_path = f"{user_id}/{filename}"
                    blob = bucket.blob(blob_path)

                    # Try download directly (no blob.exists() check - saves ~50-100ms per image)
                    try:
                        os.makedirs(user_upload_dir, exist_ok=True)
                        local_path = os.path.join(user_upload_dir, filename)
                        blob.download_to_filename(local_path)
                        logger.info(f"Downloaded {photo_id} from GCS to local storage")
                        return local_path
                    except Exception:
                        continue  # Try next extension
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
                    confidence=0.0,  # Unknown labels get 0% confidence
                    bbox=None,
                )
            else:
                # Create a manual detection result with high confidence for valid bib numbers
                manual_result = DetectionResult(
                    bib_number=bib_number,
                    confidence=1.0,  # Manual labels get 100% confidence
                    bbox=None,  # No bounding box for manual labels
                )

            # Store the manual result
            self.results[photo_id] = manual_result
            return True

        except Exception as e:
            logger.error(f"❌ Failed to manually label photo {photo_id}: {e}")
            return False
