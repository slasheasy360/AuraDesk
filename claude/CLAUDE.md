# AuraDesk Smart Inbox — Claude Development Guide

This repository contains the **AuraDesk Smart Inbox POC**, a SaaS application that unifies messaging from multiple platforms into a single inbox.

Supported platforms:
- Facebook Messenger
- Instagram Direct Messages
- WhatsApp Business Cloud API
- Gmail

The goal of the POC is to prove that users can connect accounts, receive messages, reply from a unified inbox, and see messages update in real time.

No analytics, AI, automation, or bulk messaging should be implemented in the POC.

---

# Tech Stack

Frontend
- React
- Vite
- TailwindCSS
- Socket.io Client

Backend
- Node.js
- Express.js
- Prisma ORM
- PostgreSQL
- Socket.io

Security
- AES-256-GCM encryption for OAuth tokens

Infrastructure
- Railway deployment
- ngrok for local webhook testing

---

# Database Rules

All primary keys must use UUID.

Never store OAuth tokens as plaintext.

Use AES-256-GCM encryption before saving tokens.

Database managed using Prisma.

Important tables:

users
connected_accounts
auth_tokens
conversations
messages
contacts
webhook_events_log
whatsapp_accounts

---

# Backend Architecture

Backend uses Express with modular structure:

/src
  /routes
  /controllers
  /services
  /webhooks
  /utils
  /middleware

Routes should remain thin and call service functions.

All business logic must exist in services.

Webhooks must be idempotent.

---

# Webhook Handling

All webhook payloads must be:

1. Logged immediately in `webhook_events_log`
2. Acknowledge request in under 5 seconds
3. Process asynchronously
4. Update conversations and messages
5. Emit Socket.io events

---

# Messaging Flow

Incoming Message:

Platform → Webhook → Backend → Database → Socket.io → Frontend

Outgoing Message:

Frontend → Backend → Platform API → Database → Socket.io → UI

---

# Real Time System

Use Socket.io.

Emit events:

new_message
message_status_update
conversation_update

Frontend should subscribe to these events.

---

# Frontend Layout

Dashboard layout:

Sidebar
Conversation List
Chat Window
Message Input

Design style:

- SaaS dashboard
- Similar to Intercom / Zendesk
- Clean Tailwind UI

---

# Development Principles

Claude should always:

- Use async/await
- Include error handling
- Validate inputs
- Avoid blocking operations
- Follow modular architecture
- Use environment variables for secrets

---

# OAuth Integrations

Implement OAuth for:

Gmail
Facebook

WhatsApp uses Embedded Signup.

Tokens must be stored encrypted.

---

# Development Order

1. Database schema
2. Backend scaffold
3. Gmail integration
4. Facebook Messenger integration
5. Instagram DM integration
6. WhatsApp Cloud API
7. Unified inbox UI
8. Real-time updates
9. Deployment

---

# Deployment
POC will be deployed using:

Railway.app

Requirements:

- HTTPS
- PostgreSQL
- Environment variables