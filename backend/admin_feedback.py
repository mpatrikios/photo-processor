#!/usr/bin/env python3
"""
Simple script to view feedback submissions
Usage: python admin_feedback.py
"""

import os
import json
from datetime import datetime

FEEDBACK_DIR = "feedback"

def view_feedback():
    """View all feedback submissions"""
    if not os.path.exists(FEEDBACK_DIR):
        print("No feedback directory found.")
        return
    
    feedback_files = [f for f in os.listdir(FEEDBACK_DIR) if f.startswith("feedback_") and f.endswith(".json")]
    
    if not feedback_files:
        print("No feedback submissions found.")
        return
    
    print(f"\n📬 FEEDBACK SUBMISSIONS ({len(feedback_files)} total)\n" + "="*60)
    
    for filename in sorted(feedback_files, reverse=True):  # Most recent first
        filepath = os.path.join(FEEDBACK_DIR, filename)
        try:
            with open(filepath, 'r') as f:
                feedback = json.load(f)
            
            # Format timestamp
            timestamp = datetime.fromisoformat(feedback.get('timestamp', ''))
            formatted_time = timestamp.strftime('%Y-%m-%d %H:%M:%S')
            
            # Get type emoji
            type_emoji = {
                'bug': '🐛',
                'suggestion': '💡', 
                'improvement': '⚡',
                'general': '💬'
            }.get(feedback.get('type', 'general'), '💬')
            
            print(f"\n{type_emoji} {feedback.get('type', 'general').upper()}: {feedback.get('title', 'No title')}")
            print(f"📅 {formatted_time}")
            if feedback.get('email'):
                print(f"📧 {feedback.get('email')}")
            print(f"📝 {feedback.get('description', 'No description')}")
            
            if feedback.get('system_info'):
                print(f"🖥️  {feedback.get('system_info')}")
            
            print("-" * 60)
            
        except Exception as e:
            print(f"Error reading {filename}: {e}")
    
    # Show stats
    stats = get_stats(feedback_files)
    print(f"\n📊 STATISTICS:")
    print(f"Total submissions: {stats['total']}")
    for feedback_type, count in stats['by_type'].items():
        if count > 0:
            emoji = {'bug': '🐛', 'suggestion': '💡', 'improvement': '⚡', 'general': '💬'}.get(feedback_type, '💬')
            print(f"{emoji} {feedback_type.title()}: {count}")

def get_stats(feedback_files):
    """Get feedback statistics"""
    stats = {
        "total": len(feedback_files),
        "by_type": {"bug": 0, "suggestion": 0, "improvement": 0, "general": 0}
    }
    
    for filename in feedback_files:
        filepath = os.path.join(FEEDBACK_DIR, filename)
        try:
            with open(filepath, 'r') as f:
                feedback_data = json.load(f)
                feedback_type = feedback_data.get("type", "general")
                if feedback_type in stats["by_type"]:
                    stats["by_type"][feedback_type] += 1
        except Exception:
            continue
    
    return stats

if __name__ == "__main__":
    view_feedback()