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
        
        for text in texts:
            detected_text = text.description.strip()
            
            numbers_in_text = re.findall(r'\d+', detected_text)
            for number in numbers_in_text:
                if self._is_valid_bib_number(number):
                    text_length = len(detected_text)
                    number_ratio = len(number) / text_length if text_length > 0 else 0
                    
                    base_confidence = 0.85
                    confidence = base_confidence + (number_ratio * 0.15)
                    confidence = min(confidence, 0.95)
                    
                    if confidence > best_confidence:
                        best_number = number
                        best_confidence = confidence
                        
                        vertices = text.bounding_poly.vertices
                        if vertices:
                            x_coords = [v.x for v in vertices]
                            y_coords = [v.y for v in vertices]
                            best_bbox = [min(x_coords), min(y_coords), max(x_coords), max(y_coords)]
        
        return best_number, best_confidence, best_bbox
    
    def _detect_with_tesseract(self, image: np.ndarray) -> Tuple[Optional[str], float, Optional[List[int]]]:
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        
        denoised = cv2.medianBlur(gray, 3)
        
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8,8))
        enhanced = clahe.apply(denoised)
        
        config = '--oem 3 --psm 6 -c tessedit_char_whitelist=0123456789'
        
        try:
            data = pytesseract.image_to_data(enhanced, config=config, output_type=pytesseract.Output.DICT)
            
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
            
            if best_number and best_confidence > 0.5:
                return best_number, best_confidence, best_bbox
            
        except Exception as e:
            print(f"OCR failed: {str(e)}")
        
        return None, 0.0, None
    
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