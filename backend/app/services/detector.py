import io
import logging
import os
import re
import time
import json
from typing import Dict, List, Optional, Tuple

import numpy as np
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

    async def process_photo(
            self, photo_id: str, debug_mode: bool = False, user_id: Optional[int] = None
        ) -> DetectionResult:
            """
            Process a photo to find bib numbers using Gemini 2.0 Flash only.
            """
            # ⏱️ Start timing
            photo_start_time = time.time()

            # Locate the file
            photo_path = self._find_photo_path(photo_id, user_id)
            if not photo_path:
                logger.error(f"Photo file not found: {photo_id}")
                return DetectionResult(bib_number="unknown", confidence=0.0, bbox=None)

            self._initialize_gemini_client()

            # Fail fast if Gemini is not working
            if not self.use_gemini:
                logger.error(f"Cannot process {photo_id}: Gemini is not configured.")
                return DetectionResult(bib_number="unknown", confidence=0.0, bbox=None)

            try:
                # Call Gemini
                bib_number, confidence, bbox = await self._detect_with_gemini(
                    photo_path, debug_mode
                )

                # ⏱️ Log timing
                total_time = time.time() - photo_start_time
                
                if bib_number:
                    result = DetectionResult(
                        bib_number=bib_number, confidence=confidence, bbox=bbox
                    )
                    self.results[photo_id] = result
                    logger.info(f"✅ Detected #{bib_number} ({confidence:.2f}) in {total_time:.2f}s")
                    return result
                else:
                    logger.info(f"🤷‍♂️ No bib found in {total_time:.2f}s")
                    return DetectionResult(bib_number="unknown", confidence=0.0, bbox=None)

            except Exception as e:
                logger.error(f"❌ Error processing {photo_id}: {e}")
                return DetectionResult(bib_number="error", confidence=0.0, bbox=None)

    async def process_photo_batch(
        self, photo_ids: List[str], debug_mode: bool = False, user_id: Optional[int] = None
    ) -> Dict[str, DetectionResult]:
        """
        Process multiple photos in a single Gemini API call for better performance.
        Returns a dictionary mapping photo_id to DetectionResult.
        """
        if not photo_ids:
            return {}
        
        batch_start_time = time.time()
        logger.info(f"🔄 Processing batch of {len(photo_ids)} photos with Gemini...")

        self._initialize_gemini_client()
        
        if not self.use_gemini:
            logger.error("Cannot process batch: Gemini is not configured.")
            return {photo_id: DetectionResult(bib_number="unknown", confidence=0.0, bbox=None) 
                   for photo_id in photo_ids}

        results = {}
        
        try:
            # Find and optimize all photos in the batch
            photo_data = []
            valid_photo_ids = []
            
            for photo_id in photo_ids:
                photo_path = self._find_photo_path(photo_id, user_id)
                if not photo_path:
                    logger.warning(f"Photo file not found: {photo_id}")
                    results[photo_id] = DetectionResult(bib_number="unknown", confidence=0.0, bbox=None)
                    continue
                    
                # Optimize image for Gemini
                optimized_image_data, img_shape = self._optimize_image_for_gemini(photo_path, debug_mode)
                if optimized_image_data:
                    photo_data.append((photo_id, optimized_image_data, img_shape))
                    valid_photo_ids.append(photo_id)
                else:
                    results[photo_id] = DetectionResult(bib_number="unknown", confidence=0.0, bbox=None)
            
            if not photo_data:
                logger.warning("No valid photos found in batch")
                return results
            
            # Create batch prompt for multiple photos
            batch_prompt = f"""Analyze these {len(photo_data)} race photos and find bib numbers on cyclists. Return a JSON array with this exact format:

[
  {{
    "photo_index": 0,
    "bib_number": "123",
    "confidence": "high",
    "location": "bike-mounted"
  }},
  {{
    "photo_index": 1,
    "bib_number": "456", 
    "confidence": "medium",
    "location": "jersey"
  }}
]

Rules:
- Return one entry per photo in the same order they appear
- photo_index starts at 0 and matches the image order
- Look for numbers on bike-mounted plates (lower portion) and cyclist jerseys (upper portion)
- Only detect numbers that are 1-6 digits long
- If multiple numbers exist in a photo, return the clearest and most prominent one
- Set confidence to "high", "medium", or "low"
- Set location to "bike-mounted" or "jersey"
- If no bib number is visible in a photo, set bib_number to "NONE"

Return only valid JSON array."""

            # Prepare content parts for Gemini API
            content_parts = []
            for _, image_data, _ in photo_data:
                content_parts.append(
                    types.Part.from_bytes(
                        data=image_data,
                        mime_type="image/jpeg"
                    )
                )
            content_parts.append(batch_prompt)

            # Call Gemini API with all photos
            response = await self.gemini_client.aio.models.generate_content(
                model="gemini-2.0-flash",
                contents=content_parts,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                )
            )
            
            if not response or not response.text:
                logger.warning("Empty response from Gemini batch processing")
                # Fallback to individual processing
                return await self._fallback_individual_processing(photo_ids, debug_mode, user_id)
                
            # Parse batch response
            try:
                clean_text = response.text.strip()
                if clean_text.startswith("```json"):
                    clean_text = clean_text.split("```json")[1].split("```")[0].strip()
                
                batch_results = json.loads(clean_text)
                logger.debug(f"Gemini Batch Results: {batch_results}")
                
                if not isinstance(batch_results, list):
                    logger.warning("Gemini returned non-array response, falling back to individual processing")
                    return await self._fallback_individual_processing(photo_ids, debug_mode, user_id)
                
                # Process each result and map to photo_id
                for i, result_data in enumerate(batch_results):
                    if i >= len(photo_data):
                        break
                        
                    photo_id, _, img_shape = photo_data[i]
                    
                    detected_bib = result_data.get("bib_number", "NONE")
                    confidence_level = result_data.get("confidence", "low")
                    location = result_data.get("location", "unknown")
                    
                    # Convert confidence text to number
                    confidence_map = {"high": 0.95, "medium": 0.75, "low": 0.5}
                    confidence = confidence_map.get(confidence_level, 0.5)
                    
                    # Check for valid bib number
                    if str(detected_bib).upper() == "NONE" or not self._is_valid_bib_number(str(detected_bib)):
                        results[photo_id] = DetectionResult(bib_number="unknown", confidence=0.0, bbox=None)
                    else:
                        # Create dummy bounding box based on location
                        if location == "bike-mounted":
                            bbox = [
                                int(img_shape[1] * 0.3), int(img_shape[0] * 0.5), 
                                int(img_shape[1] * 0.7), int(img_shape[0] * 0.8)
                            ]
                        else:
                            bbox = [
                                int(img_shape[1] * 0.3), int(img_shape[0] * 0.2), 
                                int(img_shape[1] * 0.7), int(img_shape[0] * 0.5)
                            ]
                        
                        results[photo_id] = DetectionResult(
                            bib_number=str(detected_bib), 
                            confidence=confidence, 
                            bbox=bbox
                        )
                        self.results[photo_id] = results[photo_id]  # Store in cache
                
                # Handle any missing results
                for photo_id in valid_photo_ids:
                    if photo_id not in results:
                        results[photo_id] = DetectionResult(bib_number="unknown", confidence=0.0, bbox=None)
                
            except json.JSONDecodeError as e:
                logger.warning(f"Failed to parse Gemini batch response: {e}")
                return await self._fallback_individual_processing(photo_ids, debug_mode, user_id)
                
        except Exception as e:
            logger.error(f"Batch processing error: {e}")
            return await self._fallback_individual_processing(photo_ids, debug_mode, user_id)
        
        total_time = time.time() - batch_start_time
        successful = len([r for r in results.values() if r.bib_number not in ["unknown", "error"]])
        logger.info(f"✅ Batch processed {len(results)} photos in {total_time:.2f}s ({successful} detected)")
        
        return results

    async def _fallback_individual_processing(
        self, photo_ids: List[str], debug_mode: bool = False, user_id: Optional[int] = None
    ) -> Dict[str, DetectionResult]:
        """Fallback to individual processing if batch processing fails"""
        logger.info(f"🔄 Falling back to individual processing for {len(photo_ids)} photos")
        results = {}
        
        for photo_id in photo_ids:
            result = await self.process_photo(photo_id, debug_mode, user_id)
            results[photo_id] = result
            
        return results

    async def _detect_with_gemini(
        self, photo_path: str, debug_mode: bool = False
    ) -> Tuple[Optional[str], float, Optional[List[int]]]:
        """Use Gemini 2.0 Flash to detect bib numbers"""
        try:
            # Optimize image for Gemini API call using PIL
            optimized_image_data, img_shape = self._optimize_image_for_gemini(photo_path, debug_mode)
            
            if not optimized_image_data:
                return None, 0.0, None

            # Prompt for Gemini
            prompt = """Analyze this race photo and find bib numbers on cyclists. Return a JSON response with this exact format:

{
  "bib_number": "123",
  "confidence": "high",
  "location": "bike-mounted"
}

Rules:
- Look for numbers on bike-mounted plates (lower portion) and cyclist jerseys (upper portion)
- Only detect numbers that are 1-6 digits long
- If multiple numbers exist, return the clearest and most prominent one
- Set confidence to "high", "medium", or "low"
- Set location to "bike-mounted" or "jersey"
- If no bib number is visible, set bib_number to "NONE"

Return only valid JSON."""

            # Call API
            response = await self.gemini_client.aio.models.generate_content(
                model="gemini-2.0-flash",
                contents=[
                    types.Part.from_bytes(
                        data=optimized_image_data,
                        mime_type="image/jpeg"
                    ),
                    prompt
                ],
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                )
            )
            
            if not response or not response.text:
                logger.warning("Empty response from Gemini")
                return None, 0.0, None
                
            try:
                # Clean the response text (sometimes Gemini wraps JSON in markdown blocks)
                clean_text = response.text.strip()
                if clean_text.startswith("```json"):
                    clean_text = clean_text.split("```json")[1].split("```")[0].strip()
                
                result = json.loads(clean_text)
                logger.debug(f"Gemini Raw Result for {photo_path}: {result}")
                detected_bib = result.get("bib_number", "NONE")
                confidence_level = result.get("confidence", "low")
                location = result.get("location", "unknown")
                
                # Convert confidence text to number
                confidence_map = {"high": 0.95, "medium": 0.75, "low": 0.5}
                confidence = confidence_map.get(confidence_level, 0.5)
                
            except json.JSONDecodeError:
                detected_bib = "NONE"
                confidence = 0.0
            
            # Check for "NONE" or invalid
            if str(detected_bib).upper() == "NONE":
                return None, 0.0, None
            
            if not self._is_valid_bib_number(str(detected_bib)):
                return None, 0.0, None
            
            # Estimate Bounding Box (Dummy box since Gemini Flash doesn't return coords yet)
            # This prevents UI crashes
            if location == "bike-mounted":
                # Lower center
                bbox = [
                    int(img_shape[1] * 0.3), int(img_shape[0] * 0.5), 
                    int(img_shape[1] * 0.7), int(img_shape[0] * 0.8)
                ]
            else:
                # Upper center
                bbox = [
                    int(img_shape[1] * 0.3), int(img_shape[0] * 0.2), 
                    int(img_shape[1] * 0.7), int(img_shape[0] * 0.5)
                ]
                        
            return str(detected_bib), confidence, bbox
            
        except Exception as e:
            logger.error(f"Gemini API error: {e}")
            return None, 0.0, None






    def _resize_image(self, image_bytes: bytes, max_size: int = 1024) -> bytes:
        """
        Resizes image in memory to max_size x max_size using PIL.
        Drastically reduces upload time - 10x smaller files.
        """
        try:
            with Image.open(io.BytesIO(image_bytes)) as img:
                # Convert to RGB to handle PNGs/CMYK
                if img.mode != 'RGB':
                    img = img.convert('RGB')
                
                original_size = img.size
                
                # Only resize if larger than max_size
                if max(img.size) > max_size:
                    img.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)
                    
                    if logger.isEnabledFor(logging.DEBUG):
                        new_size = img.size
                        reduction = ((original_size[0] * original_size[1]) - (new_size[0] * new_size[1])) / (original_size[0] * original_size[1]) * 100
                        logger.debug(f"🏎️ PIL Resize: {original_size} → {new_size} ({reduction:.0f}% smaller)")
                
                # Save back to bytes with optimized quality
                buffer = io.BytesIO()
                img.save(buffer, format="JPEG", quality=85, optimize=True)
                return buffer.getvalue()
                
        except Exception as e:
            logger.warning(f"⚠️ PIL resize failed: {e}, using original")
            return image_bytes  # Fallback to original

    def _optimize_image_for_gemini(
        self, image_path: str, debug_mode: bool = False, skip_compression: bool = False
    ) -> Tuple[bytes, Tuple[int, int]]:
        """Optimize image for Gemini API - skip compression if already client-optimized for 2x speed boost"""
        try:
            # Read image data
            with open(image_path, "rb") as f:
                original_data = f.read()
            
            # Get original dimensions for bbox calculations (PIL returns width, height)
            with Image.open(image_path) as img:
                original_width, original_height = img.size
            
            # PERFORMANCE OPTIMIZATION: Skip server compression if client already optimized to ~1024px
            if skip_compression or (max(original_width, original_height) <= 1100 and len(original_data) <= 1.5 * 1024 * 1024):
                # Image is already optimized (likely from client-side compression)
                if debug_mode:
                    logger.debug(f"⚡ Skipping server compression: {original_width}x{original_height} ({len(original_data)/1024:.0f}KB) already optimal")
                return original_data, (original_height, original_width)
            
            # Apply server-side compression for larger images
            optimized_data = self._resize_image(original_data, max_size=1024)
            
            # Calculate new dimensions after resizing
            with Image.open(io.BytesIO(optimized_data)) as resized_img:
                new_width, new_height = resized_img.size
            
            if debug_mode:
                original_kb = len(original_data) / 1024
                optimized_kb = len(optimized_data) / 1024
                reduction_pct = ((len(original_data) - len(optimized_data)) / len(original_data)) * 100
                logger.debug(
                    f"🏎️ Server compression: {original_width}x{original_height} ({original_kb:.0f}KB) → "
                    f"{new_width}x{new_height} ({optimized_kb:.0f}KB) - {reduction_pct:.0f}% smaller"
                )
            
            return optimized_data, (new_height, new_width)
            
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
