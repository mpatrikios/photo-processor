#!/usr/bin/env python3
"""
Test script for enhanced bib number detection
"""
import sys
import os
import asyncio

# Add backend path and import detector
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend'))
from app.services.detector import NumberDetector

async def test_detection():
    detector = NumberDetector()
    
    # Test images - focusing on bike racing photos
    test_images = [
        "055fea44-e47e-474c-8eb3-dc11cc6cd3e6.jpg",  # Mountain bike with bib 11
        "242b716b-7d26-4361-9923-f024d59e5430.jpg",  # Same bike image
        "2d3ecc5c-0483-40e7-b553-e6875b7fce16.jpg",  # Same bike image  
        "1f46bb05-0fe4-4863-b3f1-239f025ffad0.jpg",  # Different bike photo
        "5b4319e9-2ddc-4ac5-a33d-83b9b5734cc8.jpg",  # Another bike photo
    ]
    
    print("🧪 Testing Enhanced Bib Detection System")
    print("🎯 Optimized preprocessing + smart region detection")
    print("=" * 60)
    
    successful_detections = 0
    
    for i, image_name in enumerate(test_images, 1):
        image_id = image_name.split('.')[0]
        print(f"\n[{i}/{len(test_images)}] Testing: {image_name}")
        print("-" * 40)
        
        try:
            result = await detector.process_photo(image_id)
            if result and result.bib_number:
                print(f"✅ SUCCESS: Detected bib #{result.bib_number}")
                print(f"   📊 Confidence: {result.confidence:.3f}")
                if result.bbox:
                    x1, y1, x2, y2 = result.bbox
                    w, h = x2 - x1, y2 - y1
                    print(f"   📍 Location: ({x1},{y1}) size: {w}x{h}")
                successful_detections += 1
            else:
                print("❌ FAILED: No bib number detected")
                
        except Exception as e:
            print(f"❌ ERROR: {e}")
    
    print("\n" + "=" * 60)
    print(f"🎯 RESULTS: {successful_detections}/{len(test_images)} successful detections")
    success_rate = (successful_detections / len(test_images)) * 100
    print(f"📈 Success Rate: {success_rate:.1f}%")
    
    if success_rate >= 80:
        print("🏆 EXCELLENT: Detection system performing well!")
    elif success_rate >= 60:
        print("✅ GOOD: Detection system working adequately")
    else:
        print("⚠️  NEEDS IMPROVEMENT: Detection rate below expectations")
    
    print("\n💡 Enhanced features active:")
    print("   🎯 Smart contour-based region detection")
    print("   🌟 Enhanced image preprocessing (CLAHE + noise reduction)")
    print("   📊 Improved confidence scoring")
    print("   🔍 Multi-stage detection pipeline")
    print("   ⚡ Optimized for performance and reliability")

if __name__ == "__main__":
    asyncio.run(test_detection())