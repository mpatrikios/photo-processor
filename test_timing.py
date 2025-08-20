#!/usr/bin/env python3
"""
Simple test script to demonstrate timing functionality
"""
import requests
import json
import time
import os

# Create uploads directory if it doesn't exist
os.makedirs('uploads', exist_ok=True)

# Create a dummy image file for testing (1x1 pixel PNG)
dummy_png = b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\tpHYs\x00\x00\x0b\x13\x00\x00\x0b\x13\x01\x00\x9a\x9c\x18\x00\x00\x00\nIDATx\x9cc\xf8\x00\x00\x00\x01\x00\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00IEND\xaeB`\x82'

# Save test image
test_image_path = 'uploads/test-image.png'
with open(test_image_path, 'wb') as f:
    f.write(dummy_png)

print("📊 Testing photo processing timing...")
print("=" * 50)

try:
    # Test the processing endpoint
    response = requests.post('http://localhost:8000/api/process/start?debug=true', 
                           json=['test-image'])
    
    if response.status_code == 200:
        job_data = response.json()
        job_id = job_data['job_id']
        print(f"✅ Started processing job: {job_id}")
        
        # Poll for completion
        while True:
            status_response = requests.get(f'http://localhost:8000/api/process/status/{job_id}')
            if status_response.status_code == 200:
                status_data = status_response.json()
                print(f"📊 Job progress: {status_data['progress']}% - {status_data['status']}")
                
                if status_data['status'] in ['COMPLETED', 'FAILED']:
                    break
                    
            time.sleep(0.5)
            
        print("\n🎉 Processing complete! Check the backend logs above for detailed timing information.")
        
    else:
        print(f"❌ Failed to start processing: {response.status_code} - {response.text}")
        
except requests.exceptions.ConnectionError:
    print("❌ Could not connect to backend server. Make sure it's running on http://localhost:8000")
except Exception as e:
    print(f"❌ Error: {e}")
finally:
    # Clean up test file
    if os.path.exists(test_image_path):
        os.remove(test_image_path)
        print("🧹 Cleaned up test file")