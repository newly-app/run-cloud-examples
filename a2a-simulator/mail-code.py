"""Read only verification mail addressed to the explicitly supplied test alias."""
import email
import email.policy
import imaplib
import json
import re
import ssl
import sys

settings = json.load(sys.stdin)
try:
    with imaplib.IMAP4_SSL("imap.purelymail.com", 993, ssl_context=ssl.create_default_context(), timeout=25) as mailbox:
        mailbox.login(settings["username"], settings["password"])
        if settings.get("probe"):
            print(json.dumps({"authenticated": True}))
            sys.exit(0)
        for folder in ["INBOX", "Junk"]:
            status, _ = mailbox.select(folder, readonly=True)
            if status != "OK":
                continue
            filters = ["TO", f'"{settings["recipient"]}"']
            status, found = mailbox.uid("search", None, *filters)
            if status != "OK":
                continue
            for uid in reversed(found[0].split()[-5:]):
                status, records = mailbox.uid("fetch", uid, "(BODY.PEEK[])")
                if status != "OK":
                    continue
                for record in records:
                    if not isinstance(record, tuple):
                        continue
                    message = email.message_from_bytes(record[1], policy=email.policy.default)
                    if settings["recipient"].lower() not in str(message.get("To", "")).lower():
                        continue
                    content = str(message.get("Subject", "")) + "\n"
                    for part in message.walk():
                        if part.get_content_type() in ["text/plain", "text/html"]:
                            content += part.get_content() + "\n"
                    codes = re.findall(r"(?<!\d)\d{6}(?!\d)", content)
                    if codes:
                        print(json.dumps({"code": codes[0]}))
                        sys.exit(0)
        print(json.dumps({"pending": True}))
except Exception as error:
    # Do not emit server diagnostics, messages, or credentials.
    print(json.dumps({"error": type(error).__name__}))
    sys.exit(1)
