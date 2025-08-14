import os
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime
from typing import Optional
import asyncio
from concurrent.futures import ThreadPoolExecutor

class EmailService:
    def __init__(self):
        self.admin_email = os.getenv('ADMIN_EMAIL')
        self.smtp_host = os.getenv('SMTP_HOST', 'smtp.gmail.com')
        self.smtp_port = int(os.getenv('SMTP_PORT', '587'))
        self.smtp_username = os.getenv('SMTP_USERNAME')
        self.smtp_password = os.getenv('SMTP_PASSWORD')
        self.smtp_use_tls = os.getenv('SMTP_USE_TLS', 'true').lower() == 'true'
        
        # Thread pool for async email sending
        self.executor = ThreadPoolExecutor(max_workers=2)
    
    def is_configured(self) -> bool:
        """Check if email is properly configured"""
        required_settings = [
            self.admin_email,
            self.smtp_host,
            self.smtp_username,
            self.smtp_password
        ]
        return all(setting for setting in required_settings)
    
    def _send_email_sync(self, subject: str, body: str, to_email: str, from_email: Optional[str] = None) -> bool:
        """Send email synchronously (runs in thread pool)"""
        try:
            # Create message
            msg = MIMEMultipart('alternative')
            msg['Subject'] = subject
            msg['From'] = from_email or self.smtp_username
            msg['To'] = to_email
            
            # Add HTML body
            html_part = MIMEText(body, 'html')
            msg.attach(html_part)
            
            # Connect and send
            server = smtplib.SMTP(self.smtp_host, self.smtp_port)
            
            if self.smtp_use_tls:
                server.starttls()
            
            server.login(self.smtp_username, self.smtp_password)
            server.send_message(msg)
            server.quit()
            
            print(f"✅ Email sent successfully to {to_email}")
            return True
            
        except Exception as e:
            print(f"❌ Failed to send email to {to_email}: {str(e)}")
            return False
    
    async def send_email_async(self, subject: str, body: str, to_email: str, from_email: Optional[str] = None) -> bool:
        """Send email asynchronously"""
        if not self.is_configured():
            print("⚠️ Email not configured - skipping email notification")
            return False
        
        try:
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(
                self.executor, 
                self._send_email_sync, 
                subject, 
                body, 
                to_email, 
                from_email
            )
            return result
        except Exception as e:
            print(f"❌ Async email error: {str(e)}")
            return False
    
    def format_feedback_email(self, feedback_data: dict) -> tuple[str, str]:
        """Format feedback data into email subject and HTML body"""
        
        # Format timestamp
        try:
            timestamp = datetime.fromisoformat(feedback_data.get('timestamp', ''))
            formatted_time = timestamp.strftime('%Y-%m-%d at %H:%M:%S')
        except:
            formatted_time = feedback_data.get('timestamp', 'Unknown')
        
        # Get type color and label
        type_info = {
            'bug': {'color': '#ef4444', 'label': 'Bug Report'},
            'suggestion': {'color': '#f59e0b', 'label': 'Feature Suggestion'},
            'improvement': {'color': '#10b981', 'label': 'Improvement Idea'},
            'general': {'color': '#3b82f6', 'label': 'General Feedback'}
        }
        
        feedback_type = feedback_data.get('type', 'general')
        info = type_info.get(feedback_type, type_info['general'])
        
        # Create subject
        subject = f"New Feedback: {info['label']} - {feedback_data.get('title', 'No Title')}"
        
        # Create HTML body
        body = f"""
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <style>
                body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }}
                .header {{ background: linear-gradient(135deg, #3b82f6, #1d4ed8); color: white; padding: 20px; border-radius: 8px 8px 0 0; text-align: center; }}
                .content {{ background: #f8fafc; padding: 20px; border: 1px solid #e2e8f0; }}
                .footer {{ background: #1f2937; color: #9ca3af; padding: 15px; border-radius: 0 0 8px 8px; font-size: 12px; text-align: center; }}
                .type-badge {{ display: inline-block; background: {info['color']}; color: white; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; margin-bottom: 15px; }}
                .field {{ margin-bottom: 15px; }}
                .label {{ font-weight: 600; color: #374151; display: block; margin-bottom: 5px; }}
                .value {{ background: white; padding: 10px; border-radius: 4px; border: 1px solid #d1d5db; }}
                .system-info {{ font-family: 'Courier New', monospace; font-size: 11px; color: #6b7280; }}
            </style>
        </head>
        <body>
            <div class="header">
                <h1>TagSort Feedback</h1>
                <p>New feedback submission received</p>
            </div>
            
            <div class="content">
                <div class="type-badge">{info['label']}</div>
                
                <div class="field">
                    <span class="label">Submitted:</span>
                    <div class="value">{formatted_time}</div>
                </div>
                
                <div class="field">
                    <span class="label">Title:</span>
                    <div class="value">{feedback_data.get('title', 'No title provided')}</div>
                </div>
                
                <div class="field">
                    <span class="label">Description:</span>
                    <div class="value">{feedback_data.get('description', 'No description provided').replace('\n', '<br>')}</div>
                </div>
        """
        
        # Add email if provided
        if feedback_data.get('email'):
            body += f"""
                <div class="field">
                    <span class="label">User Email:</span>
                    <div class="value"><a href="mailto:{feedback_data['email']}">{feedback_data['email']}</a></div>
                </div>
            """
        
        # Add system info if provided
        if feedback_data.get('system_info'):
            body += f"""
                <div class="field">
                    <span class="label">System Information:</span>
                    <div class="value system-info">{feedback_data['system_info']}</div>
                </div>
            """
        
        body += f"""
            </div>
            
            <div class="footer">
                <p>This email was automatically generated by the TagSort feedback system.</p>
                <p>Feedback ID: {feedback_data.get('id', 'Unknown')}</p>
            </div>
        </body>
        </html>
        """
        
        return subject, body
    
    async def send_feedback_notification(self, feedback_data: dict) -> bool:
        """Send feedback notification email to admin"""
        if not self.is_configured():
            print("⚠️ Email not configured - skipping feedback notification")
            return False
        
        try:
            subject, body = self.format_feedback_email(feedback_data)
            
            # Send to admin email
            success = await self.send_email_async(
                subject=subject,
                body=body,
                to_email=self.admin_email,
                from_email=self.smtp_username
            )
            
            return success
            
        except Exception as e:
            print(f"❌ Failed to send feedback notification: {str(e)}")
            return False

# Global email service instance (lazy initialization)
class EmailServiceWrapper:
    def __init__(self):
        self._service = None
    
    def __getattr__(self, name):
        if self._service is None:
            self._service = EmailService()
        return getattr(self._service, name)

email_service = EmailServiceWrapper()