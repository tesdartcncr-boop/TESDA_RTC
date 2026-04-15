"""
Email service for sending OTP via Gmail SMTP.
Uses nodemailer-like configuration but implemented in Python with smtplib.
"""

import ssl
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from ..config import settings

# Gmail SMTP Configuration
GMAIL_SMTP_SERVER = "smtp.gmail.com"
GMAIL_SMTP_PORT = 587
SMTP_TIMEOUT_SECONDS = 15


def get_sender_email() -> str:
  return settings.email_sender or settings.mail_sender or "tesda.mpltp.tapat@gmail.com"


def get_sender_app_password() -> str:
  return settings.email_app_password.replace(" ", "")


def send_otp_email(recipient_email: str, otp_code: str) -> bool:
  """
  Send OTP code to recipient email via Gmail SMTP.
  
  Args:
    recipient_email: Email address to send OTP to
    otp_code: The OTP code to send
    
  Returns:
    True if email sent successfully, False otherwise
  """
  try:
    sender_email = get_sender_email()
    sender_password = get_sender_app_password()

    if not sender_password:
      raise ValueError("Missing Gmail app password in environment variables.")

    # Create message
    message = MIMEMultipart("alternative")
    message["Subject"] = "Your OTP Code for DTR System"
    message["From"] = sender_email
    message["To"] = recipient_email
    
    # HTML email body
    html_body = f"""
    <html>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #2c3e50;">DTR System - One-Time Password</h2>
          <p>Hello,</p>
          <p>You requested a one-time password (OTP) to access the DTR System.</p>
          
          <div style="background-color: #f8f9fa; padding: 20px; border-radius: 5px; text-align: center; margin: 20px 0;">
            <p style="font-size: 14px; color: #666; margin: 0 0 10px 0;">Your OTP code is:</p>
            <p style="font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #2c3e50; margin: 0;">{otp_code}</p>
          </div>
          
          <p style="color: #e74c3c; font-weight: bold;">⏱️ This code will expire in 10 minutes.</p>
          
          <p>If you did not request this code, please ignore this email.</p>
          
          <p>
            Best regards,<br>
            <strong>DTR System Team</strong>
          </p>
          
          <hr style="border: none; border-top: 1px solid #ddd; margin-top: 30px;">
          <p style="font-size: 12px; color: #999; text-align: center; margin-top: 20px;">
            This is an automated email. Please do not reply to this message.
          </p>
        </div>
      </body>
    </html>
    """
    
    # Attach HTML body
    message.attach(MIMEText(html_body, "html"))
    
    # Connect to Gmail SMTP and send
    with smtplib.SMTP(GMAIL_SMTP_SERVER, GMAIL_SMTP_PORT, timeout=SMTP_TIMEOUT_SECONDS) as server:
      server.ehlo()
      server.starttls(context=ssl.create_default_context())
      server.ehlo()
      server.login(sender_email, sender_password)
      server.sendmail(sender_email, recipient_email, message.as_string())
    
    print(f"✓ OTP email sent to {recipient_email}")
    return True
    
  except Exception as e:
    print(f"✗ Failed to send OTP email to {recipient_email}: {e}")
    return False
