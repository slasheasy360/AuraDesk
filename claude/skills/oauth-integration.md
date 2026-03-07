# Skill: OAuth Integration

OAuth flow pattern:

1 Start OAuth
2 Redirect user to provider
3 Receive callback with code
4 Exchange code for tokens
5 Encrypt tokens
6 Save in database

Tokens must be encrypted using AES-256-GCM.

Environment variable:

TOKEN_ENCRYPTION_KEY