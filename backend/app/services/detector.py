import io
import logging
import os
import re
import time
import json
from typing import Dict, List, Optional, Tuple

import numpy as np
import pytesseract
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
            # Get Gemini API key from environment
            api_key = os.getenv("GEMINI_API_KEY")
            if api_key:
                self.gemini_client = genai.Client(api_key=api_key)
                self.use_gemini = True
                logger.info("✅ Gemini 2.0 Flash API initialized successfully")
            else:
                # No API key available
                self.gemini_client = None
                self.use_gemini = False
                logger.info("🔄 No Gemini API key available - using Tesseract OCR only")
        except Exception as e:
            logger.warning(f"❌ Gemini API initialization failed: {e}")
            logger.info("🔄 Falling back to Tesseract OCR only")
            self.gemini_client = None
            self.use_gemini = False

    async def process_photo(
            self, photo_id: str, debug_mode: bool = False, user_id: Optional[int] = None
        ) -> DetectionResult:
            """
            Process a photo to find bib numbers using ONLY Gemini 2.0 Flash.
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

    async def _detect_with_gemini(
        self, photo_path: str, debug_mode: bool = False
    ) -> Tuple[Optional[str], float, Optional[List[int]]]:
        """Use Gemini 2.0 Flash to detect bib numbers"""
        try:
            # Optimize image for API call using PIL (No cv2)
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
                    types.Content(
                        role="user",
                        parts=[
                            types.Part.from_text(text=prompt),
                            types.Part.from_bytes(data=optimized_image_data, mime_type="image/jpeg")
                        ]
                    )
                ],
                config=types.GenerateContentConfig(
                    response_mime_type="application/json"
                )
            )
            
            if not response or not response.text:
                return None, 0.0, None
                
            # Parse JSON
            try:
                result = json.loads(response.text.strip())
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

    # def _detect_with_tesseract(
    #     self, image: np.ndarray, debug_mode: bool = False, photo_id: str = None
    # ) -> Tuple[Optional[str], float, Optional[List[int]]]:
    #     gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

    #     # Enhanced preprocessing for better bib number detection
    #     enhanced_image = self._preprocess_for_bib_detection(gray)
    #     bib_regions = self._find_bib_regions(enhanced_image)

    #     best_number = None
    #     best_confidence = 0.0
    #     best_bbox = None

    #     # First try OCR on detected bib regions
    #     for region_bbox in bib_regions:
    #         x1, y1, x2, y2 = region_bbox
    #         roi = enhanced_image[y1:y2, x1:x2]

    #         if roi.size == 0:
    #             continue

    #         # Try multi-scale detection for better accuracy
    #         number, confidence, rel_bbox = self._multi_scale_ocr(roi)

    #         if number and confidence > best_confidence:
    #             # Apply bib-specific confidence boost
    #             boosted_confidence = self._calculate_bib_confidence(
    #                 number, confidence, region_bbox, enhanced_image.shape, debug_mode
    #             )

    #             if boosted_confidence > best_confidence:
    #                 best_number = number
    #                 best_confidence = boosted_confidence
    #                 # Convert relative bbox to absolute coordinates
    #                 if rel_bbox:
    #                     best_bbox = [
    #                         x1 + rel_bbox[0],
    #                         y1 + rel_bbox[1],
    #                         x1 + rel_bbox[2],
    #                         y1 + rel_bbox[3],
    #                     ]
    #                 else:
    #                     best_bbox = region_bbox

    #     # If no good detection in bib regions, try full image OCR as fallback
    #     if not best_number or best_confidence < 0.4:
    #         fallback_number, fallback_conf, fallback_bbox = self._run_tesseract_on_roi(
    #             enhanced_image
    #         )
    #         if fallback_number and fallback_conf > best_confidence:
    #             best_number = fallback_number
    #             best_confidence = fallback_conf
    #             best_bbox = fallback_bbox

    #     if (
    #         best_number and best_confidence > 0.4
    #     ):  # Lowered threshold due to better targeting
    #         return best_number, best_confidence, best_bbox

    #     return None, 0.0, None

    # def _preprocess_for_bib_detection(self, gray_image: np.ndarray) -> np.ndarray:
    #     """Enhanced preprocessing specifically for bib number detection"""
    #     # Apply Gaussian blur to reduce noise
    #     denoised = cv2.GaussianBlur(gray_image, (3, 3), 0)

    #     # Apply CLAHE for better local contrast
    #     clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
    #     enhanced = clahe.apply(denoised)

    #     return enhanced

    # def _find_bib_regions(self, image: np.ndarray) -> List[List[int]]:
    #     """Find rectangular regions that could contain bike-mounted bib numbers"""
    #     bib_regions = []

    #     # Enhanced edge detection for bike number plates
    #     # Use adaptive threshold to handle varying lighting conditions
    #     adaptive_thresh = cv2.adaptiveThreshold(
    #         image, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 11, 2
    #     )

    #     # Combine with Canny edge detection for better rectangular detection
    #     edges = cv2.Canny(image, 40, 120, apertureSize=3)

    #     # Combine both methods
    #     combined = cv2.bitwise_or(edges, adaptive_thresh)

    #     # Enhanced morphological operations to connect rectangular shapes
    #     # Use rectangular kernel to favor rectangular shapes
    #     rect_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 3))
    #     combined = cv2.morphologyEx(combined, cv2.MORPH_CLOSE, rect_kernel)

    #     # Additional dilation to connect number plate boundaries
    #     dilate_kernel = np.ones((3, 3), np.uint8)
    #     edges = cv2.dilate(combined, dilate_kernel, iterations=1)

    #     # Find contours
    #     contours, _ = cv2.findContours(
    #         edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
    #     )

    #     h, w = image.shape
    #     min_area = (w * h) * 0.0005  # At least 0.05% of image area
    #     max_area = (w * h) * 0.1  # At most 10% of image area

    #     for contour in contours:
    #         area = cv2.contourArea(contour)

    #         if min_area < area < max_area:
    #             # Get bounding rectangle
    #             x, y, width, height = cv2.boundingRect(contour)

    #             # Check if aspect ratio is reasonable for a bike bib (typically rectangular number plates)
    #             aspect_ratio = width / height if height > 0 else 0

    #             # Bike number plates tend to be more rectangular (wider aspect ratios)
    #             if 1.2 <= aspect_ratio <= 5.0 and width > 25 and height > 15:
    #                 # Focus on lower portion of image (bike area)
    #                 center_y = y + height / 2
    #                 if (
    #                     center_y > h * 0.3
    #                 ):  # Only consider regions in bottom 70% of image
    #                     # Add some padding around the detected region
    #                     padding = 12
    #                     x1 = max(0, x - padding)
    #                     y1 = max(0, y - padding)
    #                     x2 = min(w, x + width + padding)
    #                     y2 = min(h, y + height + padding)

    #                     # Calculate a priority score based on bike-bib characteristics
    #                     priority_score = self._calculate_bike_bib_priority(
    #                         x, y, width, height, w, h
    #                     )
    #                     bib_regions.append([x1, y1, x2, y2, priority_score])

        # Sort by priority score (highest first), then by area
        bib_regions.sort(
            key=lambda r: (r[4] if len(r) > 4 else 0, (r[2] - r[0]) * (r[3] - r[1])),
            reverse=True,
        )
        # Return only the coordinate part (remove priority score)
        return [r[:4] for r in bib_regions[:10]]

    def _calculate_bike_bib_priority(
        self, x: int, y: int, width: int, height: int, img_w: int, img_h: int
    ) -> float:
        """Calculate priority score for bike-mounted bib regions"""
        priority = 1.0

        # Position boost: prefer lower regions (bike area)
        center_y = y + height / 2
        rel_y = center_y / img_h
        if 0.5 <= rel_y <= 0.85:  # Sweet spot for bike-mounted bibs
            priority += 0.3
        elif rel_y > 0.85:  # Very bottom - might be cut off
            priority += 0.1
        elif rel_y < 0.4:  # Upper regions - likely jersey
            priority -= 0.2

        # Horizontal position: prefer center regions
        center_x = x + width / 2
        rel_x = center_x / img_w
        if 0.3 <= rel_x <= 0.7:  # Central regions
            priority += 0.1

        # Aspect ratio boost: bike number plates are typically wider
        aspect_ratio = width / height
        if 2.0 <= aspect_ratio <= 4.0:  # Typical number plate ratios
            priority += 0.2
        elif aspect_ratio > 4.5:  # Too wide, might be other text
            priority -= 0.1

        # Size preference: medium-sized regions
        area = width * height
        img_area = img_w * img_h
        area_ratio = area / img_area
        if 0.002 <= area_ratio <= 0.03:  # Good size for bike bibs
            priority += 0.15
        elif area_ratio < 0.001:  # Too small
            priority -= 0.1

        return max(priority, 0.1)  # Minimum priority

    # def _enhance_roi_for_ocr(self, roi: np.ndarray) -> np.ndarray:
    #     """Further enhance a region of interest for OCR with motion blur handling"""
    #     if roi.size == 0:
    #         return roi

    #     # Resize if too small (helps OCR accuracy)
    #     h, w = roi.shape
    #     if h < 30 or w < 30:
    #         scale_factor = max(30 / h, 30 / w)
    #         new_h, new_w = int(h * scale_factor), int(w * scale_factor)
    #         roi = cv2.resize(roi, (new_w, new_h), interpolation=cv2.INTER_CUBIC)

    #     # Perspective correction for angled plates
    #     roi = self._correct_perspective(roi)

    #     # Motion blur detection and correction
    #     roi = self._handle_motion_blur(roi)

    #     # Apply enhanced sharpening filter for better text clarity
    #     # Use unsharp masking for better edge enhancement
    #     roi = self._apply_unsharp_masking(roi)

    #     # Ensure good contrast with adaptive enhancement
    #     roi = cv2.equalizeHist(roi)

    #     return roi

    # def _handle_motion_blur(self, roi: np.ndarray) -> np.ndarray:
    #     """Detect and reduce motion blur in ROI"""
    #     if roi.size == 0:
    #         return roi

    #     # Detect if image is blurred by analyzing edge sharpness
    #     laplacian_var = cv2.Laplacian(roi, cv2.CV_64F).var()

    #     # If variance is low, image is likely blurred
    #     if laplacian_var < 500:  # Threshold for blur detection
    #         # Apply deblurring filter
    #         # Richardson-Lucy deconvolution approximation using Wiener filter
    #         roi = self._apply_deblur_filter(roi)

    #     return roi

    def _apply_deblur_filter(self, roi: np.ndarray) -> np.ndarray:
        """Apply deblurring filter to reduce motion blur"""
        # Create motion blur kernel (horizontal motion assumed)
        kernel_size = 9
        kernel = np.zeros((kernel_size, kernel_size))
        kernel[kernel_size // 2, :] = np.ones(kernel_size)
        kernel = kernel / kernel_size

        # Apply Wiener filter approximation
        # Add small epsilon to avoid division by zero
        epsilon = 0.01
        roi_freq = np.fft.fft2(roi)
        kernel_freq = np.fft.fft2(kernel, roi.shape)

        # Wiener filter formula
        kernel_conj = np.conj(kernel_freq)
        wiener_filter = kernel_conj / (np.abs(kernel_freq) ** 2 + epsilon)

        # Apply filter
        result_freq = roi_freq * wiener_filter
        result = np.abs(np.fft.ifft2(result_freq))

        return np.uint8(np.clip(result, 0, 255))

    # def _apply_unsharp_masking(self, roi: np.ndarray) -> np.ndarray:
    #     """Apply unsharp masking for better edge enhancement"""
    #     # Create blurred version
    #     blurred = cv2.GaussianBlur(roi, (3, 3), 1.0)

    #     # Create unsharp mask
    #     unsharp = cv2.addWeighted(roi, 1.8, blurred, -0.8, 0)

    #     # Ensure values are within valid range
    #     return np.clip(unsharp, 0, 255).astype(np.uint8)

    # def _correct_perspective(self, roi: np.ndarray) -> np.ndarray:
    #     """Detect and correct perspective distortion in number plate ROI"""
    #     if roi.size == 0 or roi.shape[0] < 20 or roi.shape[1] < 20:
    #         return roi

    #     try:
    #         # Find contours to detect the number plate rectangle
    #         edges = cv2.Canny(roi, 50, 150)
    #         contours, _ = cv2.findContours(
    #             edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
    #         )

    #         if not contours:
    #             return roi

    #         # Find the largest contour (likely the number plate)
    #         largest_contour = max(contours, key=cv2.contourArea)

    #         # Approximate contour to a polygon
    #         epsilon = 0.02 * cv2.arcLength(largest_contour, True)
    #         approx = cv2.approxPolyDP(largest_contour, epsilon, True)

    #         # If we found a quadrilateral, apply perspective correction
    #         if len(approx) == 4:
    #             # Order the points: top-left, top-right, bottom-right, bottom-left
    #             pts = self._order_points(approx.reshape(4, 2))

    #             # Compute the width and height of the corrected rectangle
    #             width_a = np.sqrt(
    #                 ((pts[2][0] - pts[3][0]) ** 2) + ((pts[2][1] - pts[3][1]) ** 2)
    #             )
    #             width_b = np.sqrt(
    #                 ((pts[1][0] - pts[0][0]) ** 2) + ((pts[1][1] - pts[0][1]) ** 2)
    #             )
    #             max_width = max(int(width_a), int(width_b))

    #             height_a = np.sqrt(
    #                 ((pts[1][0] - pts[2][0]) ** 2) + ((pts[1][1] - pts[2][1]) ** 2)
    #             )
    #             height_b = np.sqrt(
    #                 ((pts[0][0] - pts[3][0]) ** 2) + ((pts[0][1] - pts[3][1]) ** 2)
    #             )
    #             max_height = max(int(height_a), int(height_b))

    #             # Define destination points for the rectangle
    #             dst = np.array(
    #                 [
    #                     [0, 0],
    #                     [max_width - 1, 0],
    #                     [max_width - 1, max_height - 1],
    #                     [0, max_height - 1],
    #                 ],
    #                 dtype="float32",
    #             )

    #             # Compute perspective transform matrix and apply it
    #             matrix = cv2.getPerspectiveTransform(pts.astype("float32"), dst)
    #             corrected = cv2.warpPerspective(roi, matrix, (max_width, max_height))

    #             return corrected

    #     except Exception:
    #         # If perspective correction fails, return original ROI
    #         pass

        return roi

    def _order_points(self, pts):
        """Order points in clockwise order: top-left, top-right, bottom-right, bottom-left"""
        # Sort points by y-coordinate
        sorted_pts = pts[np.argsort(pts[:, 1])]

        # Top two points
        top_pts = sorted_pts[:2]
        # Bottom two points
        bottom_pts = sorted_pts[2:]

        # Sort top points by x-coordinate (left to right)
        top_pts = top_pts[np.argsort(top_pts[:, 0])]
        # Sort bottom points by x-coordinate (right to left)
        bottom_pts = bottom_pts[np.argsort(bottom_pts[:, 0])[::-1]]

        # Return in order: top-left, top-right, bottom-right, bottom-left
        return np.array(
            [top_pts[0], top_pts[1], bottom_pts[0], bottom_pts[1]], dtype="float32"
        )

    # def _multi_scale_ocr(
    #     self, roi: np.ndarray
    # ) -> Tuple[Optional[str], float, Optional[List[int]]]:
    #     """Try OCR at multiple scales to handle varying number plate sizes"""
    #     if roi.size == 0:
    #         return None, 0.0, None

    #     scales = [0.8, 1.0, 1.3, 1.6]  # Try different scales
    #     best_result = (None, 0.0, None)

    #     for scale in scales:
    #         if scale != 1.0:
    #             # Resize ROI
    #             h, w = roi.shape
    #             new_h, new_w = int(h * scale), int(w * scale)
    #             if new_h > 15 and new_w > 15:  # Ensure minimum size
    #                 scaled_roi = cv2.resize(
    #                     roi, (new_w, new_h), interpolation=cv2.INTER_CUBIC
    #                 )
    #             else:
    #                 continue
    #         else:
    #             scaled_roi = roi

    #         # Apply enhancements
    #         enhanced_roi = self._enhance_roi_for_ocr(scaled_roi)

    #         # Try OCR
    #         number, confidence, bbox = self._run_tesseract_on_roi(enhanced_roi)

    #         # Scale back bbox coordinates if needed
    #         if bbox and scale != 1.0:
    #             bbox = [int(coord / scale) for coord in bbox]

    #         # Keep the best result
    #         if number and confidence > best_result[1]:
    #             best_result = (number, confidence, bbox)

    #     return best_result

    def _run_tesseract_on_roi(
        self, roi: np.ndarray
    ) -> Tuple[Optional[str], float, Optional[List[int]]]:
        """Run Tesseract OCR on a specific region"""
        if roi.size == 0:
            return None, 0.0, None

        # Optimized Tesseract config for numbers
        config = "--oem 3 --psm 8 -c tessedit_char_whitelist=0123456789"

        try:
            data = pytesseract.image_to_data(
                roi, config=config, output_type=pytesseract.Output.DICT
            )

            best_number = None
            best_confidence = 0.0
            best_bbox = None

            for i in range(len(data["text"])):
                text = data["text"][i].strip()
                conf = float(data["conf"][i])

                if text and self._is_valid_bib_number(text) and conf > best_confidence:
                    best_number = text
                    best_confidence = conf / 100.0

                    x, y, w, h = (
                        data["left"][i],
                        data["top"][i],
                        data["width"][i],
                        data["height"][i],
                    )
                    best_bbox = [x, y, x + w, y + h]

            return best_number, best_confidence, best_bbox

        except Exception:
            return None, 0.0, None

    def _calculate_bib_confidence(
        self,
        number: str,
        base_confidence: float,
        bbox: List[int],
        image_shape: Tuple[int, int],
        debug_mode: bool = False,
    ) -> float:
        """Calculate enhanced confidence score based on bib-specific criteria"""
        confidence = base_confidence

        # Size boost: prefer medium-sized detections (not too small/large)
        x1, y1, x2, y2 = bbox
        width, height = x2 - x1, y2 - y1
        area = width * height
        img_area = image_shape[0] * image_shape[1]
        area_ratio = area / img_area

        # Resolution-adaptive area ratio thresholds
        img_height = image_shape[0]
        is_high_res = img_height > 4000

        # Adjust optimal area ratios based on image resolution
        if is_high_res:
            # High-res images (>4000px): expanded area ratios for better detection
            min_ratio, max_ratio = 0.0001, 0.03
            penalty_min, penalty_max = 0.00005, 0.08
        else:
            # Standard resolution images: original thresholds
            min_ratio, max_ratio = 0.001, 0.05
            penalty_min, penalty_max = 0.0005, 0.1

        if min_ratio <= area_ratio <= max_ratio:
            confidence *= 1.2
        elif area_ratio < penalty_min or area_ratio > penalty_max:
            confidence *= 0.9

        # Aspect ratio boost: bibs are typically wider than tall but not extremely so
        aspect_ratio = width / height if height > 0 else 0
        if 1.0 <= aspect_ratio <= 3.0:
            confidence *= 1.1

        # Position boost: bike-mounted bibs are in the lower portions of images
        img_h, img_w = image_shape
        center_x, center_y = (x1 + x2) / 2, (y1 + y2) / 2
        rel_x, rel_y = center_x / img_w, center_y / img_h

        # Position boosting is now handled in the Google Vision detection phase
        # to avoid double-boosting and maintain granular control

        # Number length boost: 1-4 digit numbers are most common in events
        if 1 <= len(number) <= 4:
            confidence *= 1.1

        # Texture analysis boost: prefer rigid surfaces over fabric
        texture_score = self._analyze_region_texture(bbox, image_shape)
        confidence *= texture_score

        # Final confidence cap
        final_confidence = min(confidence, 0.99)  # Cap at 99%

        return final_confidence

    def _analyze_region_texture(
        self, bbox: List[int], image_shape: Tuple[int, int]
    ) -> float:
        """Analyze texture characteristics to distinguish bike plates from fabric"""
        # This is a simplified texture analysis - in a full implementation,
        # you'd analyze the actual image region. For now, we use heuristics based on
        # position and size that correlate with rigid vs fabric surfaces.

        x1, y1, x2, y2 = bbox
        width, height = x2 - x1, y2 - y1
        img_h, img_w = image_shape

        texture_score = 1.0

        # Position-based texture inference
        center_y = (y1 + y2) / 2
        rel_y = center_y / img_h

        # Lower regions more likely to be rigid bike parts
        if rel_y > 0.6:
            texture_score = 1.1  # Boost for bike area
        elif rel_y < 0.4:
            texture_score = 0.9  # Slight penalty for upper body area

        # Sharp, rectangular regions are more likely to be number plates
        aspect_ratio = width / height if height > 0 else 0
        if 1.5 <= aspect_ratio <= 4.0:
            texture_score *= 1.05  # Boost for plate-like dimensions

        # Size characteristics: very small or very large regions are less likely to be proper bibs
        area = width * height
        img_area = img_w * img_h
        area_ratio = area / img_area

        if 0.002 <= area_ratio <= 0.05:  # Good size range for bike number plates
            texture_score *= 1.05
        elif area_ratio < 0.001:  # Too small, might be noise
            texture_score *= 0.8
        elif area_ratio > 0.1:  # Too large, might be background
            texture_score *= 0.9

        return max(texture_score, 0.7)  # Minimum texture score

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
        self, image_path: str, debug_mode: bool = False
    ) -> Tuple[bytes, Tuple[int, int]]:
        """Optimize image for Gemini API using PIL - 10x faster upload via 1024px resizing"""
        try:
            # Read original image data
            with open(image_path, "rb") as f:
                original_data = f.read()
            
            # Get original dimensions for bbox calculations
            with Image.open(image_path) as img:
                original_width, original_height = img.size
            
            # Resize using PIL for optimal performance
            optimized_data = self._resize_image(original_data, max_size=1024)
            
            # Calculate new dimensions after resizing
            with Image.open(io.BytesIO(optimized_data)) as resized_img:
                new_width, new_height = resized_img.size
            
            if debug_mode:
                original_kb = len(original_data) / 1024
                optimized_kb = len(optimized_data) / 1024
                reduction_pct = ((len(original_data) - len(optimized_data)) / len(original_data)) * 100
                logger.debug(
                    f"🏎️ PIL optimization: {original_width}x{original_height} ({original_kb:.0f}KB) → "
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

    # def _optimize_image_for_api(
    #     self, image_path: str, debug_mode: bool = False
    # ) -> bytes:
    #     """Optimize image size for Google Vision API while preserving text quality"""
    #     # Read image
    #     image = cv2.imread(image_path)
    #     if image is None:
    #         raise ValueError(f"Could not load image {image_path}")

    #     height, width = image.shape[:2]
    #     original_size = len(
    #         cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, 95])[1].tobytes()
    #     )

    #     # Resize to max 2400px (preserves text readability while reducing file size)
    #     max_dimension = 2400
    #     if max(height, width) > max_dimension:
    #         if width > height:
    #             new_width = max_dimension
    #             new_height = int(height * (max_dimension / width))
    #         else:
    #             new_height = max_dimension
    #             new_width = int(width * (max_dimension / height))

    #         image = cv2.resize(
    #             image, (new_width, new_height), interpolation=cv2.INTER_AREA
    #         )

    #         if debug_mode:
    #             optimized_size = len(
    #                 cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, 90])[
    #                     1
    #                 ].tobytes()
    #             )
    #             logger.debug(
    #                 f"📏 Image optimized: {width}x{height} ({original_size/1024/1024:.1f}MB) → {new_width}x{new_height} ({optimized_size/1024/1024:.1f}MB)"
    #             )

    #     # Compress to JPEG with 90% quality (good balance of size vs quality)
    #     _, buffer = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, 90])
    #     return buffer.tobytes()

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
