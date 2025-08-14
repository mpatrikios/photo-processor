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
    
    async def process_photo(self, photo_id: str, debug_mode: bool = False) -> DetectionResult:
        photo_path = self._find_photo_path(photo_id)
        if not photo_path:
            raise FileNotFoundError(f"Photo {photo_id} not found")
        
        if debug_mode:
            print(f"🔍 DEBUG: Starting detection for {photo_id} at {photo_path}")
        
        # Initialize Google Vision client if needed
        self._initialize_vision_client()
        
        google_result = None
        tesseract_result = None
        
        if self.use_google_vision:
            try:
                bib_number, confidence, bbox = await self._detect_with_google_vision(photo_path, debug_mode)
                google_result = (bib_number, confidence, bbox)
                if debug_mode:
                    print(f"🔍 DEBUG: Google Vision result - Number: {bib_number}, Confidence: {confidence:.3f}")
                
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
        
        bib_number, confidence, bbox = self._detect_with_tesseract(image, debug_mode, photo_id)
        tesseract_result = (bib_number, confidence, bbox)
        
        if debug_mode:
            print(f"🔍 DEBUG: Tesseract result - Number: {bib_number}, Confidence: {confidence:.3f}")
            self._log_detection_comparison(google_result, tesseract_result, photo_id)
        
        # If no reliable detection from either method, mark as unknown
        if not bib_number or confidence < 0.5:
            print(f"❌ No reliable bib number detected for {photo_id}, marking as unknown")
            if debug_mode:
                print(f"🔍 DEBUG: Detection failed - Final confidence {confidence:.3f} below threshold 0.5")
            result = DetectionResult(
                bib_number="unknown",
                confidence=0.0,
                bbox=None
            )
        else:
            print(f"🎯 Tesseract detected bib #{bib_number} (confidence: {confidence:.2f}) for {photo_id}")
            result = DetectionResult(
                bib_number=bib_number,
                confidence=confidence,
                bbox=bbox
            )
        
        self.results[photo_id] = result
        return result
    
    async def _detect_with_google_vision(self, photo_path: str, debug_mode: bool = False) -> Tuple[Optional[str], float, Optional[List[int]]]:
        with open(photo_path, 'rb') as image_file:
            content = image_file.read()
        
        image = vision.Image(content=content)
        response = self.vision_client.text_detection(image=image)
        
        if response.error.message:
            raise Exception(f"Google Vision API error: {response.error.message}")
        
        texts = response.text_annotations
        
        if debug_mode:
            print(f"🔍 DEBUG: Google Vision found {len(texts)} text annotations")
        
        best_number = None
        best_confidence = 0.0
        best_bbox = None
        all_candidates = []
        
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
                    
                    # Enhanced confidence calculation for Google Vision (bike-focused)
                    text_length = len(detected_text)
                    number_ratio = len(number) / text_length if text_length > 0 else 0
                    
                    # Base confidence starts higher for cleaner text (higher number ratio)
                    base_confidence = 0.75 + (number_ratio * 0.15)
                    
                    # Position-based filtering for bike bibs
                    center_y = (bbox[1] + bbox[3]) / 2
                    rel_y = center_y / img_shape[0] if img_shape[0] > 0 else 0
                    
                    # Debug position calculations
                    if debug_mode:
                        print(f"    🔍 Y-Position Debug: Number {number} at Y={center_y:.0f}, img_height={img_shape[0]}, rel_y={rel_y:.3f}")
                    
                    # Store original confidence for comparison
                    original_confidence = base_confidence
                    
                    # Granular position-based boosting for bike-mounted bibs
                    boost_factor = 1.0
                    boost_category = "neutral"
                    
                    if rel_y > 0.85:  # Bottom 15% of image (definitely bike area)
                        boost_factor = 1.6
                        boost_category = "Bottom15%-MaxBike"
                        base_confidence *= boost_factor
                    elif rel_y > 0.75:  # Bottom 25% of image (likely bike area)  
                        boost_factor = 1.4
                        boost_category = "Bottom25%-StrongBike"
                        base_confidence *= boost_factor
                    elif rel_y > 0.65:  # Bottom 35% of image (possible bike area)
                        boost_factor = 1.2
                        boost_category = "Bottom35%-ModerateBike"
                        base_confidence *= boost_factor
                    elif rel_y > 0.5:   # Middle-lower region
                        boost_factor = 1.0
                        boost_category = "Middle-Neutral"
                        # No change to base_confidence
                    elif rel_y < 0.4:   # Upper region (cyclist body) - jersey area
                        boost_factor = 0.6
                        boost_category = "Upper-JerseyPenalty"
                        base_confidence *= boost_factor
                    
                    # Debug boost application
                    if debug_mode:
                        print(f"    🔍 Boost Applied: {boost_category} ({boost_factor}x) - Before: {original_confidence:.3f} → After: {base_confidence:.3f}")
                    
                    # Store confidence before _calculate_bib_confidence for debugging
                    pre_bib_calc_confidence = base_confidence
                    
                    # Apply bike-specific confidence boost
                    enhanced_confidence = self._calculate_bib_confidence(
                        number, base_confidence, bbox, img_shape, debug_mode
                    )
                    
                    if debug_mode:
                        print(f"    🔍 After bib_confidence calc: {pre_bib_calc_confidence:.3f} → {enhanced_confidence:.3f}")
                    
                    # Store confidence before final adjustments
                    pre_final_confidence = enhanced_confidence
                    
                    # Additional boost for standalone numbers (likely to be bib numbers)
                    if number_ratio > 0.8:  # Number takes up most of the detected text
                        enhanced_confidence *= 1.1
                        if debug_mode:
                            print(f"    🔍 Standalone number boost (1.1x): {pre_final_confidence:.3f} → {enhanced_confidence:.3f}")
                    
                    # Boost for numbers in bike number plate dimensions
                    width = bbox[2] - bbox[0]
                    height = bbox[3] - bbox[1]
                    aspect_ratio = width / height if height > 0 else 0
                    pre_aspect_confidence = enhanced_confidence
                    
                    if 1.5 <= aspect_ratio <= 4.0:  # Typical bike number plate ratios
                        enhanced_confidence *= 1.1
                        if debug_mode:
                            print(f"    🔍 Plate aspect boost (1.1x, ratio={aspect_ratio:.2f}): {pre_aspect_confidence:.3f} → {enhanced_confidence:.3f}")
                    elif aspect_ratio < 1.0:  # Too tall - likely not a bike bib
                        enhanced_confidence *= 0.9
                        if debug_mode:
                            print(f"    🔍 Tall aspect penalty (0.9x, ratio={aspect_ratio:.2f}): {pre_aspect_confidence:.3f} → {enhanced_confidence:.3f}")
                    
                    # Final confidence cap
                    pre_cap_confidence = enhanced_confidence
                    enhanced_confidence = min(enhanced_confidence, 1.5)  # Allow higher confidence for position-boosted results
                    
                    if debug_mode and pre_cap_confidence != enhanced_confidence:
                        print(f"    🔍 Confidence capped at 1.5: {pre_cap_confidence:.3f} → {enhanced_confidence:.3f}")
                    
                    if debug_mode:
                        print(f"    🔍 FINAL CONFIDENCE for '{number}': {enhanced_confidence:.3f}")
                    
                    if debug_mode:
                        all_candidates.append({
                            'text': detected_text,
                            'number': number,
                            'raw_confidence': base_confidence,
                            'boosted_confidence': enhanced_confidence,
                            'bbox': bbox,
                            'position': f"({bbox[0]}, {bbox[1]}, {bbox[2]}, {bbox[3]})"
                        })
                    
                    if enhanced_confidence > best_confidence:
                        best_number = number
                        best_confidence = enhanced_confidence
                        best_bbox = bbox
        
        if debug_mode and all_candidates:
            print(f"🔍 DEBUG: Google Vision candidates ({len(all_candidates)} found):")
            for i, candidate in enumerate(sorted(all_candidates, key=lambda x: x['boosted_confidence'], reverse=True)[:5]):
                print(f"  {i+1}. '{candidate['text']}' → Number: {candidate['number']}, Raw: {candidate['raw_confidence']:.3f}, Boosted: {candidate['boosted_confidence']:.3f}, Position: {candidate['position']}")
        
        return best_number, best_confidence, best_bbox
    
    def _detect_with_tesseract(self, image: np.ndarray, debug_mode: bool = False, photo_id: str = None) -> Tuple[Optional[str], float, Optional[List[int]]]:
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        
        # Enhanced preprocessing for better bib number detection
        enhanced_image = self._preprocess_for_bib_detection(gray)
        
        # Find potential bib regions using contour detection
        bib_regions = self._find_bib_regions(enhanced_image)
        
        if debug_mode:
            print(f"🔍 DEBUG: Tesseract found {len(bib_regions)} potential bib regions")
        
        best_number = None
        best_confidence = 0.0
        best_bbox = None
        region_results = []
        
        # First try OCR on detected bib regions
        for region_bbox in bib_regions:
            x1, y1, x2, y2 = region_bbox
            roi = enhanced_image[y1:y2, x1:x2]
            
            if roi.size == 0:
                continue
            
            # Try multi-scale detection for better accuracy
            number, confidence, rel_bbox = self._multi_scale_ocr(roi)
            
            if debug_mode and number:
                region_results.append({
                    'region': f"({x1}, {y1}, {x2}, {y2})",
                    'number': number,
                    'raw_confidence': confidence,
                    'roi_size': f"{roi.shape[1]}x{roi.shape[0]}"
                })
            
            if number and confidence > best_confidence:
                # Apply bib-specific confidence boost
                boosted_confidence = self._calculate_bib_confidence(
                    number, confidence, region_bbox, enhanced_image.shape, debug_mode
                )
                
                if debug_mode:
                    region_results[-1]['boosted_confidence'] = boosted_confidence
                
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
        
        if debug_mode and region_results:
            print(f"🔍 DEBUG: Tesseract region results ({len(region_results)} processed):")
            for i, result in enumerate(sorted(region_results, key=lambda x: x.get('boosted_confidence', x['raw_confidence']), reverse=True)[:3]):
                conf_info = f"Raw: {result['raw_confidence']:.3f}"
                if 'boosted_confidence' in result:
                    conf_info += f", Boosted: {result['boosted_confidence']:.3f}"
                print(f"  {i+1}. Region {result['region']} → Number: {result['number']}, {conf_info}, ROI: {result['roi_size']}")
        
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
        """Find rectangular regions that could contain bike-mounted bib numbers"""
        bib_regions = []
        
        # Enhanced edge detection for bike number plates
        # Use adaptive threshold to handle varying lighting conditions
        adaptive_thresh = cv2.adaptiveThreshold(
            image, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 11, 2
        )
        
        # Combine with Canny edge detection for better rectangular detection
        edges = cv2.Canny(image, 40, 120, apertureSize=3)
        
        # Combine both methods
        combined = cv2.bitwise_or(edges, adaptive_thresh)
        
        # Enhanced morphological operations to connect rectangular shapes
        # Use rectangular kernel to favor rectangular shapes
        rect_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 3))
        combined = cv2.morphologyEx(combined, cv2.MORPH_CLOSE, rect_kernel)
        
        # Additional dilation to connect number plate boundaries
        dilate_kernel = np.ones((3, 3), np.uint8)
        edges = cv2.dilate(combined, dilate_kernel, iterations=1)
        
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
                
                # Check if aspect ratio is reasonable for a bike bib (typically rectangular number plates)
                aspect_ratio = width / height if height > 0 else 0
                
                # Bike number plates tend to be more rectangular (wider aspect ratios)
                if 1.2 <= aspect_ratio <= 5.0 and width > 25 and height > 15:
                    # Focus on lower portion of image (bike area)
                    center_y = y + height / 2
                    if center_y > h * 0.3:  # Only consider regions in bottom 70% of image
                        # Add some padding around the detected region
                        padding = 12
                        x1 = max(0, x - padding)
                        y1 = max(0, y - padding)
                        x2 = min(w, x + width + padding)
                        y2 = min(h, y + height + padding)
                        
                        # Calculate a priority score based on bike-bib characteristics
                        priority_score = self._calculate_bike_bib_priority(x, y, width, height, w, h)
                        bib_regions.append([x1, y1, x2, y2, priority_score])
        
        # Sort by priority score (highest first), then by area
        bib_regions.sort(key=lambda r: (r[4] if len(r) > 4 else 0, (r[2] - r[0]) * (r[3] - r[1])), reverse=True)
        # Return only the coordinate part (remove priority score) 
        return [r[:4] for r in bib_regions[:10]]
    
    def _calculate_bike_bib_priority(self, x: int, y: int, width: int, height: int, 
                                   img_w: int, img_h: int) -> float:
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
    
    def _enhance_roi_for_ocr(self, roi: np.ndarray) -> np.ndarray:
        """Further enhance a region of interest for OCR with motion blur handling"""
        if roi.size == 0:
            return roi
        
        # Resize if too small (helps OCR accuracy)
        h, w = roi.shape
        if h < 30 or w < 30:
            scale_factor = max(30 / h, 30 / w)
            new_h, new_w = int(h * scale_factor), int(w * scale_factor)
            roi = cv2.resize(roi, (new_w, new_h), interpolation=cv2.INTER_CUBIC)
        
        # Perspective correction for angled plates
        roi = self._correct_perspective(roi)
        
        # Motion blur detection and correction
        roi = self._handle_motion_blur(roi)
        
        # Apply enhanced sharpening filter for better text clarity
        # Use unsharp masking for better edge enhancement
        roi = self._apply_unsharp_masking(roi)
        
        # Ensure good contrast with adaptive enhancement
        roi = cv2.equalizeHist(roi)
        
        return roi
    
    def _handle_motion_blur(self, roi: np.ndarray) -> np.ndarray:
        """Detect and reduce motion blur in ROI"""
        if roi.size == 0:
            return roi
        
        # Detect if image is blurred by analyzing edge sharpness
        laplacian_var = cv2.Laplacian(roi, cv2.CV_64F).var()
        
        # If variance is low, image is likely blurred
        if laplacian_var < 500:  # Threshold for blur detection
            # Apply deblurring filter
            # Richardson-Lucy deconvolution approximation using Wiener filter
            roi = self._apply_deblur_filter(roi)
        
        return roi
    
    def _apply_deblur_filter(self, roi: np.ndarray) -> np.ndarray:
        """Apply deblurring filter to reduce motion blur"""
        # Create motion blur kernel (horizontal motion assumed)
        kernel_size = 9
        kernel = np.zeros((kernel_size, kernel_size))
        kernel[kernel_size//2, :] = np.ones(kernel_size)
        kernel = kernel / kernel_size
        
        # Apply Wiener filter approximation
        # Add small epsilon to avoid division by zero
        epsilon = 0.01
        roi_freq = np.fft.fft2(roi)
        kernel_freq = np.fft.fft2(kernel, roi.shape)
        
        # Wiener filter formula
        kernel_conj = np.conj(kernel_freq)
        wiener_filter = kernel_conj / (np.abs(kernel_freq)**2 + epsilon)
        
        # Apply filter
        result_freq = roi_freq * wiener_filter
        result = np.abs(np.fft.ifft2(result_freq))
        
        return np.uint8(np.clip(result, 0, 255))
    
    def _apply_unsharp_masking(self, roi: np.ndarray) -> np.ndarray:
        """Apply unsharp masking for better edge enhancement"""
        # Create blurred version
        blurred = cv2.GaussianBlur(roi, (3, 3), 1.0)
        
        # Create unsharp mask
        unsharp = cv2.addWeighted(roi, 1.8, blurred, -0.8, 0)
        
        # Ensure values are within valid range
        return np.clip(unsharp, 0, 255).astype(np.uint8)
    
    def _correct_perspective(self, roi: np.ndarray) -> np.ndarray:
        """Detect and correct perspective distortion in number plate ROI"""
        if roi.size == 0 or roi.shape[0] < 20 or roi.shape[1] < 20:
            return roi
        
        try:
            # Find contours to detect the number plate rectangle
            edges = cv2.Canny(roi, 50, 150)
            contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            
            if not contours:
                return roi
            
            # Find the largest contour (likely the number plate)
            largest_contour = max(contours, key=cv2.contourArea)
            
            # Approximate contour to a polygon
            epsilon = 0.02 * cv2.arcLength(largest_contour, True)
            approx = cv2.approxPolyDP(largest_contour, epsilon, True)
            
            # If we found a quadrilateral, apply perspective correction
            if len(approx) == 4:
                # Order the points: top-left, top-right, bottom-right, bottom-left
                pts = self._order_points(approx.reshape(4, 2))
                
                # Compute the width and height of the corrected rectangle
                width_a = np.sqrt(((pts[2][0] - pts[3][0]) ** 2) + ((pts[2][1] - pts[3][1]) ** 2))
                width_b = np.sqrt(((pts[1][0] - pts[0][0]) ** 2) + ((pts[1][1] - pts[0][1]) ** 2))
                max_width = max(int(width_a), int(width_b))
                
                height_a = np.sqrt(((pts[1][0] - pts[2][0]) ** 2) + ((pts[1][1] - pts[2][1]) ** 2))
                height_b = np.sqrt(((pts[0][0] - pts[3][0]) ** 2) + ((pts[0][1] - pts[3][1]) ** 2))
                max_height = max(int(height_a), int(height_b))
                
                # Define destination points for the rectangle
                dst = np.array([
                    [0, 0],
                    [max_width - 1, 0],
                    [max_width - 1, max_height - 1],
                    [0, max_height - 1]
                ], dtype="float32")
                
                # Compute perspective transform matrix and apply it
                matrix = cv2.getPerspectiveTransform(pts.astype("float32"), dst)
                corrected = cv2.warpPerspective(roi, matrix, (max_width, max_height))
                
                return corrected
            
        except Exception:
            # If perspective correction fails, return original ROI
            pass
        
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
        return np.array([top_pts[0], top_pts[1], bottom_pts[0], bottom_pts[1]], dtype="float32")
    
    def _multi_scale_ocr(self, roi: np.ndarray) -> Tuple[Optional[str], float, Optional[List[int]]]:
        """Try OCR at multiple scales to handle varying number plate sizes"""
        if roi.size == 0:
            return None, 0.0, None
        
        scales = [0.8, 1.0, 1.3, 1.6]  # Try different scales
        best_result = (None, 0.0, None)
        
        for scale in scales:
            if scale != 1.0:
                # Resize ROI
                h, w = roi.shape
                new_h, new_w = int(h * scale), int(w * scale)
                if new_h > 15 and new_w > 15:  # Ensure minimum size
                    scaled_roi = cv2.resize(roi, (new_w, new_h), interpolation=cv2.INTER_CUBIC)
                else:
                    continue
            else:
                scaled_roi = roi
            
            # Apply enhancements
            enhanced_roi = self._enhance_roi_for_ocr(scaled_roi)
            
            # Try OCR
            number, confidence, bbox = self._run_tesseract_on_roi(enhanced_roi)
            
            # Scale back bbox coordinates if needed
            if bbox and scale != 1.0:
                bbox = [int(coord / scale) for coord in bbox]
            
            # Keep the best result
            if number and confidence > best_result[1]:
                best_result = (number, confidence, bbox)
        
        return best_result
    
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
                                 bbox: List[int], image_shape: Tuple[int, int], debug_mode: bool = False) -> float:
        """Calculate enhanced confidence score based on bib-specific criteria"""
        confidence = base_confidence
        
        if debug_mode:
            print(f"      🔍 _calculate_bib_confidence START: number='{number}', base={base_confidence:.3f}")
        
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
            # High-res images (>4000px): smaller relative area ratios
            min_ratio, max_ratio = 0.0003, 0.02
            penalty_min, penalty_max = 0.0001, 0.05
        else:
            # Standard resolution images: original thresholds
            min_ratio, max_ratio = 0.001, 0.05
            penalty_min, penalty_max = 0.0005, 0.1
        
        if debug_mode:
            print(f"      🔍 Area ratio: {area_ratio:.6f}, img_height={img_height}px, is_high_res={is_high_res}")
            print(f"      🔍 Area thresholds - optimal: {min_ratio:.6f}-{max_ratio:.6f}, penalty: <{penalty_min:.6f} or >{penalty_max:.6f}")
        
        pre_area_confidence = confidence
        if min_ratio <= area_ratio <= max_ratio:
            confidence *= 1.2
            if debug_mode:
                print(f"      🔍 Area boost (1.2x): {pre_area_confidence:.3f} → {confidence:.3f}")
        elif area_ratio < penalty_min or area_ratio > penalty_max:
            confidence *= 0.8
            if debug_mode:
                print(f"      🔍 Area penalty (0.8x): {pre_area_confidence:.3f} → {confidence:.3f}")
        
        # Aspect ratio boost: bibs are typically wider than tall but not extremely so
        aspect_ratio = width / height if height > 0 else 0
        pre_aspect_confidence = confidence
        if 1.0 <= aspect_ratio <= 3.0:
            confidence *= 1.1
            if debug_mode:
                print(f"      🔍 Aspect boost (1.1x, ratio={aspect_ratio:.2f}): {pre_aspect_confidence:.3f} → {confidence:.3f}")
        
        # Position boost: bike-mounted bibs are in the lower portions of images
        img_h, img_w = image_shape
        center_x, center_y = (x1 + x2) / 2, (y1 + y2) / 2
        rel_x, rel_y = center_x / img_w, center_y / img_h
        
        # Position boosting is now handled in the Google Vision detection phase
        # to avoid double-boosting and maintain granular control
        
        # Number length boost: 1-4 digit numbers are most common in events
        pre_length_confidence = confidence
        if 1 <= len(number) <= 4:
            confidence *= 1.1
            if debug_mode:
                print(f"      🔍 Length boost (1.1x, len={len(number)}): {pre_length_confidence:.3f} → {confidence:.3f}")
        
        # Texture analysis boost: prefer rigid surfaces over fabric
        pre_texture_confidence = confidence
        texture_score = self._analyze_region_texture(bbox, image_shape)
        confidence *= texture_score
        if debug_mode:
            print(f"      🔍 Texture boost ({texture_score:.3f}x): {pre_texture_confidence:.3f} → {confidence:.3f}")
        
        # Final confidence cap
        pre_cap_confidence = confidence
        final_confidence = min(confidence, 0.99)  # Cap at 99%
        
        if debug_mode:
            if pre_cap_confidence != final_confidence:
                print(f"      🔍 Capped at 0.99: {pre_cap_confidence:.3f} → {final_confidence:.3f}")
            print(f"      🔍 _calculate_bib_confidence END: {final_confidence:.3f}")
        
        return final_confidence
    
    def _analyze_region_texture(self, bbox: List[int], image_shape: Tuple[int, int]) -> float:
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
    
    def _log_detection_comparison(self, google_result, tesseract_result, photo_id: str):
        """Log comparison between Google Vision and Tesseract results"""
        print(f"🔍 DEBUG: Detection comparison for {photo_id}:")
        
        if google_result:
            g_num, g_conf, g_bbox = google_result
            print(f"  Google Vision: {g_num or 'None'} (confidence: {g_conf:.3f})")
        else:
            print(f"  Google Vision: Not available")
        
        if tesseract_result:
            t_num, t_conf, t_bbox = tesseract_result
            print(f"  Tesseract: {t_num or 'None'} (confidence: {t_conf:.3f})")
        
        # Analyze disagreement
        if google_result and tesseract_result:
            g_num, g_conf, _ = google_result
            t_num, t_conf, _ = tesseract_result
            if g_num != t_num and g_num and t_num:
                print(f"  ⚠️  Methods disagree: Google={g_num}, Tesseract={t_num}")
    
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
            # Handle "unknown" labels specially
            if bib_number.lower() == "unknown":
                # For unknown labels, keep them as unknown
                manual_result = DetectionResult(
                    bib_number="unknown",
                    confidence=0.0,  # Unknown labels get 0% confidence
                    bbox=None
                )
            else:
                # Create a manual detection result with high confidence for valid bib numbers
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