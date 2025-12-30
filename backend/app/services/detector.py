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
        Sequential Processing for Maximum Accuracy (Batch Size 1).
        Processes photos individually to eliminate 'context bleeding' and digit count forcing.
        Fixes the '648 vs 7' hallucination issue by focusing on digit integrity over forced counting.
        """
        if not photo_ids:
            return {}

        batch_start_time = time.time()
        self._initialize_gemini_client()
        
        if not self.use_gemini:
            logger.error("Cannot process batch: Gemini is not configured.")
            return {photo_id: DetectionResult(bib_number="unknown", confidence=0.0, bbox=None) 
                   for photo_id in photo_ids}

        results = {}
        logger.info(f"🔄 SEQUENTIAL PROCESSING: Starting {len(photo_ids)} photos individually")
        
        # Process each photo INDIVIDUALLY for absolute focus
        for i, photo_id in enumerate(photo_ids):
            photo_start_time = time.time()
            
            try:
                logger.info(f"📸 [{i+1}/{len(photo_ids)}] Processing {photo_id[:8]}...")
                
                photo_path = self._find_photo_path(photo_id, user_id)
                if not photo_path:
                    logger.warning(f"❌ [{photo_id[:8]}] Photo file not found")
                    results[photo_id] = DetectionResult(bib_number="unknown", confidence=0.0, bbox=None)
                    continue

                # Load 3072px optimized data
                image_data, img_shape = self._optimize_image_for_gemini(photo_path, debug_mode)
                if not image_data:
                    logger.warning(f"❌ [{photo_id[:8]}] Failed to optimize image")
                    results[photo_id] = DetectionResult(bib_number="unknown", confidence=0.0, bbox=None)
                    continue
                
                # REFINED PROMPT: Focus on Digit Integrity over Count
                # This fixes the "648 vs 7" issue by allowing the model to reject background graphics
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
  "confidence": "high/medium/low",
  "reasoning": "Explain why shapes were identified as digits or rejected as graphics"
}"""

                content = [
                    types.Part.from_bytes(data=image_data, mime_type="image/jpeg"),
                    single_prompt
                ]

                # Sequential API Call
                logger.info(f"🤖 [{photo_id[:8]}] Calling Gemini with Digit Integrity prompt...")
                response = await self.gemini_client.aio.models.generate_content(
                    model="gemini-2.0-flash",
                    contents=content,
                    config=types.GenerateContentConfig(response_mime_type="application/json")
                )

                if not response or not response.text:
                    logger.error(f"❌ [{photo_id[:8]}] Empty Gemini response")
                    results[photo_id] = DetectionResult(bib_number="unknown", confidence=0.0, bbox=None)
                    continue

                # Enhanced JSON parsing with error handling
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
                            results[photo_id] = DetectionResult(bib_number="unknown", confidence=0.0, bbox=None)
                            continue
                        # Take the first element from array
                        res_json = res_json[0]
                        logger.debug(f"🔧 ARRAY HANDLING [{photo_id[:8]}]: Extracted first element from array response")
                    elif not isinstance(res_json, dict):
                        logger.error(f"❌ INVALID FORMAT [{photo_id[:8]}]: Expected dict or list, got {type(res_json)} - {clean_text[:100]}...")
                        results[photo_id] = DetectionResult(bib_number="unknown", confidence=0.0, bbox=None)
                        continue
                    
                    # Extract and validate fields
                    detected_bib = str(res_json.get("number", "")).strip()
                    plate_description = res_json.get("plate_description", "No description")
                    digit_count = res_json.get("digit_count", 0)
                    confidence_text = res_json.get("confidence", "low")
                    reasoning = res_json.get("reasoning", "No reasoning provided")
                    
                    # Enhanced logging with reasoning
                    logger.info(f"🔍 PLATE [{photo_id[:8]}] ({confidence_text}): {plate_description}")
                    logger.info(f"🔢 REASONING [{photo_id[:8]}]: {reasoning}")
                    logger.info(f"📊 DIGITS [{photo_id[:8]}]: Detected '{detected_bib}' ({digit_count} digit{'s' if digit_count != 1 else ''})")
                    
                    # Validate detected bib number
                    if not detected_bib or detected_bib.upper() in ["NONE", "NULL", "UNKNOWN", ""]:
                        logger.info(f"❌ EMPTY [{photo_id[:8]}]: No number detected - {reasoning}")
                        results[photo_id] = DetectionResult(bib_number="unknown", confidence=0.0, bbox=None)
                    elif not self._is_valid_bib_number(detected_bib):
                        logger.info(f"❌ INVALID [{photo_id[:8]}]: '{detected_bib}' failed validation - {reasoning}")
                        results[photo_id] = DetectionResult(bib_number="unknown", confidence=0.0, bbox=None)
                    else:
                        # Convert text confidence to numeric
                        confidence_map = {"high": 0.95, "medium": 0.75, "low": 0.5}
                        numeric_confidence = confidence_map.get(confidence_text.lower(), 0.5)
                        
                        # Create center-focused bounding box
                        bbox = [
                            int(img_shape[1] * 0.25), int(img_shape[0] * 0.3), 
                            int(img_shape[1] * 0.75), int(img_shape[0] * 0.7)
                        ]
                        
                        photo_time = time.time() - photo_start_time
                        logger.info(f"✅ SUCCESS [{photo_id[:8]}] ({confidence_text}): '{detected_bib}' in {photo_time:.2f}s")
                        
                        results[photo_id] = DetectionResult(
                            bib_number=detected_bib,
                            confidence=numeric_confidence,
                            bbox=bbox
                        )
                        self.results[photo_id] = results[photo_id]  # Store in cache

                except json.JSONDecodeError as e:
                    logger.error(f"❌ JSON ERROR [{photo_id[:8]}]: {e} - Response: {response.text[:200]}...")
                    results[photo_id] = DetectionResult(bib_number="unknown", confidence=0.0, bbox=None)
                except KeyError as e:
                    logger.error(f"❌ MISSING FIELD [{photo_id[:8]}]: {e} - Response: {response.text[:200]}...")
                    results[photo_id] = DetectionResult(bib_number="unknown", confidence=0.0, bbox=None)

            except Exception as e:
                logger.error(f"❌ PROCESSING ERROR [{photo_id[:8]}]: {e}")
                results[photo_id] = DetectionResult(bib_number="unknown", confidence=0.0, bbox=None)

        # Final summary
        total_time = time.time() - batch_start_time
        successful_count = len([r for r in results.values() if r.bib_number not in ["unknown", "error"]])
        success_rate = (successful_count / len(photo_ids)) * 100 if photo_ids else 0
        
        logger.info(f"🎯 SEQUENTIAL COMPLETE: {successful_count}/{len(photo_ids)} detected ({success_rate:.1f}% success) in {total_time:.2f}s")
        
        return results



    def _resize_image(self, image_bytes: bytes, max_size: int = 1536) -> bytes:
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
                img.save(buffer, format="JPEG", quality=95, optimize=False)
                return buffer.getvalue()
                
        except Exception as e:
            logger.warning(f"⚠️ PIL resize failed: {e}, using original")
            return image_bytes  # Fallback to original

    def _optimize_image_for_gemini(
        self, image_path: str, debug_mode: bool = False
    ) -> Tuple[bytes, Tuple[int, int]]:
        """Send raw images to Gemini for maximum OCR accuracy"""
        try:
            # Read raw image data - NO COMPRESSION
            with open(image_path, "rb") as f:
                original_data = f.read()
            
            # Get original dimensions for bbox calculations (PIL returns width, height)
            with Image.open(image_path) as img:
                original_width, original_height = img.size
            
            # COMPRESSION DISABLED: Return raw image data for maximum OCR accuracy
            if debug_mode:
                logger.info(f"📷 RAW IMAGE: {original_width}x{original_height} ({len(original_data)/1024:.0f}KB) - NO COMPRESSION")
                
            return original_data, (original_height, original_width)
            
        except Exception as e:
            logger.error(f"PIL optimization failed: {e}, using original")
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
                        logger.info(f"Downloaded {photo_id} from GCS to local storage")
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
