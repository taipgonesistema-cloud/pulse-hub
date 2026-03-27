# UX Improvement Plan

## Objective

Improve the dashboard UX so it feels faster, clearer, lighter, and closer to modern operational products like WhatsApp Web, Umbler Talk, and Olist.

## Phase 1 - Quick Wins

### Navigation

- reduce click friction between `Dashboard`, `Conversations`, `Contacts`, and `Analytics`
- make active, hover, and transition states clearer
- add keyboard shortcuts for:
  - opening search
  - moving between chats
  - sending messages

### Conversations

- prefetch the next likely conversation on hover and keyboard navigation
- keep scroll state more stable when switching chats
- highlight unread messages more clearly
- add a "new messages" separator in timeline
- improve composer with:
  - attachment preview
  - drag-and-drop
  - sending/upload states

### Visual Feedback

- standardize skeletons and loading states across all views
- improve empty states so they explain what to do next
- add subtle toast feedback for:
  - success
  - error
  - reconnect/sync events

## Phase 2 - Perceived Performance

### Realtime

- make new chats and messages enter without layout jumps
- add soft insertion animations for new items
- improve sync/activity badges so realtime state is obvious

### Performance Perception

- prefetch likely data paths ahead of user actions
- keep transitions short and intentional
- reduce full-page rerenders
- isolate heavy sections into smaller components
- virtualize:
  - conversation list if it grows large
  - message timeline if it grows large

## Phase 3 - Information Quality

### Contacts / CRM

- persist filters between navigations
- make search faster and more tolerant
- improve discoverability of contextual actions
- make the side profile panel more useful and less decorative

### Density and Legibility

- calm down typography hierarchy
- reduce chip/badge noise
- keep primary information visible before secondary details
- increase whitespace between major blocks

## Phase 4 - Design System Consistency

### Visual Consistency

- define a single standard for:
  - cards
  - tables
  - buttons
  - modals
  - pills
  - loading states
- align the dashboard visual language more closely with the provided reference
- keep the interface more open and less "zoomed"

## Suggested Implementation Order

1. navigation states and keyboard shortcuts
2. conversation switching UX and message timeline polish
3. loading/skeleton/toast standardization
4. contacts CRM persistence and action clarity
5. rerender reduction and prefetching
6. virtualization where needed
7. visual consistency pass across all pages

## Success Criteria

- switching views feels immediate and intentional
- switching chats does not feel frozen
- new messages/chats appear smoothly in realtime
- user always understands whether something is loading, sending, or failed
- dashboard feels visually lighter and more open
- high-density pages remain readable with large data volumes
