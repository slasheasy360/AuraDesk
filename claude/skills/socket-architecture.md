# Skill: Socket.io Architecture

Use Socket.io for real-time updates.

Events:

new_message
conversation_update
message_status_update

Backend emits events after saving messages.

Frontend subscribes to events when user opens dashboard.

Use rooms based on user_id.