import asyncio
import logging
import os
import smtplib
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional, Tuple

logger = logging.getLogger(__name__)


class EmailService:
    def __init__(self):
        self.admin_email = os.getenv("ADMIN_EMAIL")
        self.smtp_host = os.getenv("SMTP_HOST", "smtp.gmail.com")
        self.smtp_port = int(os.getenv("SMTP_PORT", "587"))
        self.smtp_username = os.getenv("SMTP_USERNAME")
        self.smtp_password = os.getenv("SMTP_PASSWORD")
        self.smtp_use_tls = os.getenv("SMTP_USE_TLS", "true").lower() == "true"

        # Thread pool for async email sending
        self.executor = ThreadPoolExecutor(max_workers=2)

    def is_configured(self) -> bool:
        """Check if email is properly configured"""
        required_settings = [
            self.admin_email,
            self.smtp_host,
            self.smtp_username,
            self.smtp_password,
        ]
        return all(setting for setting in required_settings)

    def _send_email_sync(
        self, subject: str, body: str, to_email: str, from_email: Optional[str] = None
    ) -> bool:
        """Send email synchronously (runs in thread pool)"""
        try:
            # Create message
            msg = MIMEMultipart("alternative")
            msg["Subject"] = subject
            msg["From"] = from_email or self.smtp_username
            msg["To"] = to_email

            # Add HTML body
            html_part = MIMEText(body, "html")
            msg.attach(html_part)

            # Connect and send
            server = smtplib.SMTP(self.smtp_host, self.smtp_port)

            if self.smtp_use_tls:
                server.starttls()

            server.login(self.smtp_username, self.smtp_password)
            server.send_message(msg)
            server.quit()

            logger.info(f"Email sent successfully to {to_email}")
            return True

        except Exception as e:
            logger.error(f"Failed to send email to {to_email}: {str(e)}")
            return False

    async def send_email_async(
        self, subject: str, body: str, to_email: str, from_email: Optional[str] = None
    ) -> bool:
        """Send email asynchronously"""
        if not self.is_configured():
            logger.info("Email not configured - skipping email notification")
            return False

        try:
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(
                self.executor,
                self._send_email_sync,
                subject,
                body,
                to_email,
                from_email,
            )
            return result
        except Exception as e:
            logger.error(f"Async email error: {str(e)}")
            return False

    def format_feedback_email(self, feedback_data: dict) -> Tuple[str, str]:
        """Format feedback data into email subject and HTML body"""

        # Format timestamp
        try:
            timestamp = datetime.fromisoformat(feedback_data.get("timestamp", ""))
            formatted_time = timestamp.strftime("%Y-%m-%d at %H:%M:%S")
        except:
            formatted_time = feedback_data.get("timestamp", "Unknown")

        # Get type color and label
        type_info = {
            "bug": {"color": "#ef4444", "label": "Bug Report"},
            "suggestion": {"color": "#f59e0b", "label": "Feature Suggestion"},
            "improvement": {"color": "#10b981", "label": "Improvement Idea"},
            "general": {"color": "#3b82f6", "label": "General Feedback"},
        }

        feedback_type = feedback_data.get("type", "general")
        info = type_info.get(feedback_type, type_info["general"])

        # Create subject
        subject = (
            f"New Feedback: {info['label']} - {feedback_data.get('title', 'No Title')}"
        )

        # FIX: Process description outside f-string to avoid SyntaxError in Python 3.11
        description_text = feedback_data.get('description', 'No description provided')
        description_html = description_text.replace('\n', '<br>')

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
                    <div class="value">{description_html}</div>
                </div>
        """

        # Add email if provided
        if feedback_data.get("email"):
            body += f"""
                <div class="field">
                    <span class="label">User Email:</span>
                    <div class="value"><a href="mailto:{feedback_data['email']}">{feedback_data['email']}</a></div>
                </div>
            """

        # Add system info if provided
        if feedback_data.get("system_info"):
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
            logger.info("Email not configured - skipping feedback notification")
            return False

        try:
            subject, body = self.format_feedback_email(feedback_data)

            # Send to admin email
            success = await self.send_email_async(
                subject=subject,
                body=body,
                to_email=self.admin_email,
                from_email=self.smtp_username,
            )

            return success

        except Exception as e:
            logger.error(f"Failed to send feedback notification: {str(e)}")
            return False

    async def send_password_reset_email(
        self, user_email: str, user_name: str, reset_token: str, ip_address: str = None
    ) -> bool:
        """Send password reset email with secure token"""
        if not self.is_configured():
            logger.info("Email not configured - skipping password reset email")
            return False

        try:
            # Build reset URL - in production, use your actual domain
            reset_url = f"http://localhost:5173/reset-password?token={reset_token}"
            
            subject = "Password Reset Request - TagSort"
            
            body = f"""
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <style>
                    body {{ 
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
                        line-height: 1.6; 
                        color: #333; 
                        max-width: 600px; 
                        margin: 0 auto; 
                        padding: 20px; 
                    }}
                    .container {{ 
                        background: #ffffff; 
                        border: 1px solid #e0e0e0; 
                        border-radius: 8px; 
                        padding: 30px; 
                    }}
                    .header {{ 
                        text-align: center; 
                        margin-bottom: 30px; 
                    }}
                    .logo {{ 
                        font-size: 32px; 
                        font-weight: bold; 
                        color: #3b82f6; 
                    }}
                    h1 {{ 
                        color: #1f2937; 
                        font-size: 24px; 
                        margin-top: 20px; 
                    }}
                    .button {{ 
                        display: inline-block; 
                        background: #3b82f6; 
                        color: white !important; 
                        padding: 12px 30px; 
                        border-radius: 6px; 
                        text-decoration: none; 
                        font-weight: 600; 
                        margin: 20px 0; 
                    }}
                    .button:hover {{ 
                        background: #2563eb; 
                    }}
                    .warning {{ 
                        background: #fef3c7; 
                        border: 1px solid #f59e0b; 
                        border-radius: 6px; 
                        padding: 15px; 
                        margin: 20px 0; 
                    }}
                    .footer {{ 
                        margin-top: 30px; 
                        padding-top: 20px; 
                        border-top: 1px solid #e0e0e0; 
                        font-size: 12px; 
                        color: #6b7280; 
                        text-align: center; 
                    }}
                    .security-info {{ 
                        background: #f3f4f6; 
                        padding: 10px; 
                        border-radius: 4px; 
                        font-size: 12px; 
                        margin-top: 20px; 
                    }}
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <div class="logo">📸 TagSort</div>
                        <h1>Password Reset Request</h1>
                    </div>
                    
                    <p>Hi {user_name},</p>
                    
                    <p>We received a request to reset your password for your TagSort account. 
                    If you made this request, click the button below to reset your password:</p>
                    
                    <div style="text-align: center;">
                        <a href="{reset_url}" class="button">Reset Password</a>
                    </div>
                    
                    <p style="font-size: 14px; color: #6b7280;">
                        Or copy and paste this link into your browser:<br>
                        <code style="background: #f3f4f6; padding: 5px; word-break: break-all;">
                            {reset_url}
                        </code>
                    </p>
                    
                    <div class="warning">
                        <strong>⚠️ Important Security Information:</strong>
                        <ul style="margin: 10px 0;">
                            <li>This link will expire in <strong>1 hour</strong></li>
                            <li>The link can only be used <strong>once</strong></li>
                            <li>If you didn't request this reset, please ignore this email</li>
                            <li>Your password won't change unless you click the link and create a new one</li>
                        </ul>
                    </div>
                    
                    <div class="security-info">
                        <strong>Security Details:</strong><br>
                        Request made from IP: {ip_address or 'Unknown'}<br>
                        Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S UTC')}
                    </div>
                    
                    <div class="footer">
                        <p>This is an automated message from TagSort. Please do not reply to this email.</p>
                        <p>If you're having trouble clicking the button, copy and paste the URL above into your browser.</p>
                        <p style="margin-top: 20px;">
                            © 2024 TagSort. All rights reserved.<br>
                            <a href="#" style="color: #6b7280;">Privacy Policy</a> | 
                            <a href="#" style="color: #6b7280;">Terms of Service</a>
                        </p>
                    </div>
                </div>
            </body>
            </html>
            """

            # Send email
            success = await self.send_email_async(
                subject=subject,
                body=body,
                to_email=user_email,
                from_email=self.smtp_username,
            )

            if success:
                logger.info(f"Password reset email sent to {user_email}")
            else:
                logger.error(f"Failed to send password reset email to {user_email}")

            return success

        except Exception as e:
            logger.error(f"Failed to send password reset email: {str(e)}")
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