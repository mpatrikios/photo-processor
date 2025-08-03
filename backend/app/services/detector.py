import cv2
import pytesseract
import numpy as np
import os
import re
from typing import Dict, List, Optional, Tuple
from google.cloud import vision
from google.cloud.vision_v1 import types
import io
from app.models.schemas import DetectionResult, PhotoInfo, ProcessingStatus, GroupedPhotos

class NumberDetector:
    def __init__(self):
        self.results: Dict[str, DetectionResult] = {}
        self.vision_client = None
        self.use_google_vision = None  # Will be determined on first use
    
    def _initialize_vision_client(self):
        """Initialize Google Vision client lazily when first needed"""
        if self.use_google_vision is not None:
            return  # Already initialized
            
        try:
            self.vision_client = vision.ImageAnnotatorClient()
            self.use_google_vision = True
            print("✅ Google Cloud Vision API initialized successfully")
        except Exception as e:
            print(f"❌ Google Cloud Vision API not available: {e}")
            print("🔄 Falling back to Tesseract OCR only")
            self.vision_client = None
            self.use_google_vision = False
    
    async def process_photo(self, photo_id: str) -> DetectionResult:
        photo_path = self._find_photo_path(photo_id)
        if not photo_path:
            raise FileNotFoundError(f"Photo {photo_id} not found")
        
        # Initialize Google Vision client if needed
        self._initialize_vision_client()
        
        if self.use_google_vision:
            try:
                bib_number, confidence, bbox = await self._detect_with_google_vision(photo_path)
                if bib_number and confidence > 0.6:
                    result = DetectionResult(
                        bib_number=bib_number,
                        confidence=confidence,
                        bbox=bbox
                    )
                    self.results[photo_id] = result
                    print(f"🎯 Google Vision detected bib #{bib_number} (confidence: {confidence:.2f}) for {photo_id}")
                    return result
            except Exception as e:
                print(f"❌ Google Vision failed for {photo_id}: {e}")
        
        print(f"🔄 Using Tesseract fallback for {photo_id}")
        image = cv2.imread(photo_path)
        if image is None:
            raise ValueError(f"Could not load image {photo_path}")
        
        bib_number, confidence, bbox = self._detect_with_tesseract(image)
        
        result = DetectionResult(
            bib_number=bib_number,
            confidence=confidence,
            bbox=bbox
        )
        
        self.results[photo_id] = result
        return result
    
    async def _detect_with_google_vision(self, photo_path: str) -> Tuple[Optional[str], float, Optional[List[int]]]:
        with open(photo_path, 'rb') as image_file:
            content = image_file.read()
        
        image = vision.Image(content=content)
        response = self.vision_client.text_detection(image=image)
        
        if response.error.message:
            raise Exception(f"Google Vision API error: {response.error.message}")
        
        texts = response.text_annotations
        
        best_number = None
        best_confidence = 0.0
        best_bbox = None
        
        # Get image dimensions for confidence calculation
        import cv2
        img = cv2.imread(photo_path)
        img_shape = img.shape[:2] if img is not None else (1, 1)
        
        for text in texts:
            detected_text = text.description.strip()
            
            # Skip the first annotation (full text) to focus on individual text elements
            if text == texts[0] and len(texts) > 1:
                continue
            
            # Look for standalone numbers or numbers with minimal surrounding text
            numbers_in_text = re.findall(r'\d+', detected_text)
            for number in numbers_in_text:
                if self._is_valid_bib_number(number):
                    # Calculate bounding box
                    vertices = text.bounding_poly.vertices
                    if not vertices:
                        continue
                    
                    x_coords = [v.x for v in vertices]
                    y_coords = [v.y for v in vertices]
                    bbox = [min(x_coords), min(y_coords), max(x_coords), max(y_coords)]
                    
                    # Enhanced confidence calculation for Google Vision
                    text_length = len(detected_text)
                    number_ratio = len(number) / text_length if text_length > 0 else 0
                    
                    # Base confidence starts higher for cleaner text (higher number ratio)
                    base_confidence = 0.75 + (number_ratio * 0.15)
                    
                    # Apply bib-specific confidence boost
                    enhanced_confidence = self._calculate_bib_confidence(
                        number, base_confidence, bbox, img_shape
                    )
                    
                    # Additional boost for standalone numbers (likely to be bib numbers)
                    if number_ratio > 0.8:  # Number takes up most of the detected text
                        enhanced_confidence *= 1.1
                    
                    # Boost for numbers in rectangular regions (more likely to be bibs)
                    width = bbox[2] - bbox[0]
                    height = bbox[3] - bbox[1]
                    aspect_ratio = width / height if height > 0 else 0
                    if 1.0 <= aspect_ratio <= 3.5:
                        enhanced_confidence *= 1.05
                    
                    enhanced_confidence = min(enhanced_confidence, 0.98)
                    
                    if enhanced_confidence > best_confidence:
                        best_number = number
                        best_confidence = enhanced_confidence
                        best_bbox = bbox
        
        return best_number, best_confidence, best_bbox
    
    def _detect_with_tesseract(self, image: np.ndarray) -> Tuple[Optional[str], float, Optional[List[int]]]:
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        
        # Enhanced preprocessing for better bib number detection
        enhanced_image = self._preprocess_for_bib_detection(gray)
        
        # Find potential bib regions using contour detection
        bib_regions = self._find_bib_regions(enhanced_image)
        
        best_number = None
        best_confidence = 0.0
        best_bbox = None
        
        # First try OCR on detected bib regions
        for region_bbox in bib_regions:
            x1, y1, x2, y2 = region_bbox
            roi = enhanced_image[y1:y2, x1:x2]
            
            if roi.size == 0:
                continue
            
            # Further enhance the ROI for OCR
            roi_enhanced = self._enhance_roi_for_ocr(roi)
            
            number, confidence, rel_bbox = self._run_tesseract_on_roi(roi_enhanced)
            
            if number and confidence > best_confidence:
                # Apply bib-specific confidence boost
                boosted_confidence = self._calculate_bib_confidence(
                    number, confidence, region_bbox, enhanced_image.shape
                )
                
                if boosted_confidence > best_confidence:
                    best_number = number
                    best_confidence = boosted_confidence
                    # Convert relative bbox to absolute coordinates
                    if rel_bbox:
                        best_bbox = [
                            x1 + rel_bbox[0], y1 + rel_bbox[1],
                            x1 + rel_bbox[2], y1 + rel_bbox[3]
                        ]
                    else:
                        best_bbox = region_bbox
        
        # If no good detection in bib regions, try full image OCR as fallback
        if not best_number or best_confidence < 0.4:
            fallback_number, fallback_conf, fallback_bbox = self._run_tesseract_on_roi(enhanced_image)
            if fallback_number and fallback_conf > best_confidence:
                best_number = fallback_number
                best_confidence = fallback_conf
                best_bbox = fallback_bbox
        
        if best_number and best_confidence > 0.3:  # Lowered threshold due to better targeting
            return best_number, best_confidence, best_bbox
        
        return None, 0.0, None
    
    def _preprocess_for_bib_detection(self, gray_image: np.ndarray) -> np.ndarray:
        """Enhanced preprocessing specifically for bib number detection"""
        # Apply Gaussian blur to reduce noise
        denoised = cv2.GaussianBlur(gray_image, (3, 3), 0)
        
        # Apply CLAHE for better local contrast
        clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
        enhanced = clahe.apply(denoised)
        
        return enhanced
    
    def _find_bib_regions(self, image: np.ndarray) -> List[List[int]]:
        """Find rectangular regions that could contain bib numbers"""
        bib_regions = []
        
        # Apply edge detection
        edges = cv2.Canny(image, 50, 150, apertureSize=3)
        
        # Apply morphological operations to connect edges
        kernel = np.ones((3, 3), np.uint8)
        edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel)
        
        # Find contours
        contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        
        h, w = image.shape
        min_area = (w * h) * 0.0005  # At least 0.05% of image area
        max_area = (w * h) * 0.1     # At most 10% of image area
        
        for contour in contours:
            area = cv2.contourArea(contour)
            
            if min_area < area < max_area:
                # Get bounding rectangle
                x, y, width, height = cv2.boundingRect(contour)
                
                # Check if aspect ratio is reasonable for a bib (not too tall/wide)
                aspect_ratio = width / height if height > 0 else 0
                
                if 0.5 <= aspect_ratio <= 4.0 and width > 20 and height > 15:
                    # Add some padding around the detected region
                    padding = 10
                    x1 = max(0, x - padding)
                    y1 = max(0, y - padding)
                    x2 = min(w, x + width + padding)
                    y2 = min(h, y + height + padding)
                    
                    bib_regions.append([x1, y1, x2, y2])
        
        # Sort by area (largest first) and limit to top 10 candidates
        bib_regions.sort(key=lambda r: (r[2] - r[0]) * (r[3] - r[1]), reverse=True)
        return bib_regions[:10]
    
    
    def _enhance_roi_for_ocr(self, roi: np.ndarray) -> np.ndarray:
        """Further enhance a region of interest for OCR"""
        if roi.size == 0:
            return roi
        
        # Resize if too small (helps OCR accuracy)
        h, w = roi.shape
        if h < 30 or w < 30:
            scale_factor = max(30 / h, 30 / w)
            new_h, new_w = int(h * scale_factor), int(w * scale_factor)
            roi = cv2.resize(roi, (new_w, new_h), interpolation=cv2.INTER_CUBIC)
        
        # Apply sharpening filter
        kernel = np.array([[-1,-1,-1], [-1,9,-1], [-1,-1,-1]])
        roi = cv2.filter2D(roi, -1, kernel)
        
        # Ensure good contrast
        roi = cv2.equalizeHist(roi)
        
        return roi
    
    def _run_tesseract_on_roi(self, roi: np.ndarray) -> Tuple[Optional[str], float, Optional[List[int]]]:
        """Run Tesseract OCR on a specific region"""
        if roi.size == 0:
            return None, 0.0, None
        
        # Optimized Tesseract config for numbers
        config = '--oem 3 --psm 8 -c tessedit_char_whitelist=0123456789'
        
        try:
            data = pytesseract.image_to_data(roi, config=config, output_type=pytesseract.Output.DICT)
            
            best_number = None
            best_confidence = 0.0
            best_bbox = None
            
            for i in range(len(data['text'])):
                text = data['text'][i].strip()
                conf = float(data['conf'][i])
                
                if text and self._is_valid_bib_number(text) and conf > best_confidence:
                    best_number = text
                    best_confidence = conf / 100.0
                    
                    x, y, w, h = data['left'][i], data['top'][i], data['width'][i], data['height'][i]
                    best_bbox = [x, y, x + w, y + h]
            
            return best_number, best_confidence, best_bbox
            
        except Exception as e:
            print(f"OCR failed on ROI: {str(e)}")
            return None, 0.0, None
    
    def _calculate_bib_confidence(self, number: str, base_confidence: float, 
                                 bbox: List[int], image_shape: Tuple[int, int]) -> float:
        """Calculate enhanced confidence score based on bib-specific criteria"""
        confidence = base_confidence
        
        # Size boost: prefer medium-sized detections (not too small/large)
        x1, y1, x2, y2 = bbox
        width, height = x2 - x1, y2 - y1
        area = width * height
        img_area = image_shape[0] * image_shape[1]
        area_ratio = area / img_area
        
        # Optimal area ratio for bib numbers (empirically determined)
        if 0.001 <= area_ratio <= 0.05:
            confidence *= 1.2
        elif area_ratio < 0.0005 or area_ratio > 0.1:
            confidence *= 0.8
        
        # Aspect ratio boost: bibs are typically wider than tall but not extremely so
        aspect_ratio = width / height if height > 0 else 0
        if 1.0 <= aspect_ratio <= 3.0:
            confidence *= 1.1
        
        # Position boost: bibs are often in the center or upper portions of images
        img_h, img_w = image_shape
        center_x, center_y = (x1 + x2) / 2, (y1 + y2) / 2
        rel_x, rel_y = center_x / img_w, center_y / img_h
        
        # Slight boost for central and upper regions
        if 0.2 <= rel_x <= 0.8 and 0.1 <= rel_y <= 0.7:
            confidence *= 1.05
        
        # Number length boost: 1-4 digit numbers are most common in races
        if 1 <= len(number) <= 4:
            confidence *= 1.1
        
        return min(confidence, 0.99)  # Cap at 99%
    
    def _is_valid_bib_number(self, text: str) -> bool:
        if len(text) < 1 or len(text) > 6:
            return False
        
        if not re.match(r'^\d+$', text):
            return False
        
        number = int(text)
        return 1 <= number <= 99999
    
    def _find_photo_path(self, photo_id: str) -> Optional[str]:
        extensions = [".jpg", ".jpeg", ".png", ".tiff", ".bmp"]
        
        for directory in ["uploads", "processed"]:
            for ext in extensions:
                path = os.path.join(directory, f"{photo_id}{ext}")
                if os.path.exists(path):
                    return path
        
        return None
    
    async def get_grouped_results(self, photo_ids: List[str]) -> List[GroupedPhotos]:
        groups: Dict[str, List[PhotoInfo]] = {}
        
        for photo_id in photo_ids:
            result = self.results.get(photo_id)
            photo_path = self._find_photo_path(photo_id)
            
            photo_info = PhotoInfo(
                id=photo_id,
                filename=os.path.basename(photo_path) if photo_path else f"{photo_id}.jpg",
                original_path=photo_path or "",
                detection_result=result,
                status=ProcessingStatus.COMPLETED if result else ProcessingStatus.FAILED
            )
            
            bib_number = result.bib_number if result and result.bib_number else "unknown"
            
            if bib_number not in groups:
                groups[bib_number] = []
            
            groups[bib_number].append(photo_info)
        
        return [
            GroupedPhotos(
                bib_number=bib_number,
                photos=photos,
                count=len(photos)
            )
            for bib_number, photos in groups.items()
        ]
    
    def update_manual_label(self, photo_id: str, bib_number: str) -> bool:
        """Update a photo's detection result with a manual label"""
        try:
            # Create a manual detection result with high confidence
            manual_result = DetectionResult(
                bib_number=bib_number,
                confidence=1.0,  # Manual labels get 100% confidence
                bbox=None  # No bounding box for manual labels
            )
            
            # Store the manual result
            self.results[photo_id] = manual_result
            
            print(f"✅ Manually labeled photo {photo_id} as bib #{bib_number}")
            return True
            
        except Exception as e:
            print(f"❌ Failed to manually label photo {photo_id}: {e}")
            return False