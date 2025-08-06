# Session Title Implementation Plan

## Overview
This plan outlines the implementation of session title display and editing functionality in Goose's desktop UI. The goal is to:

1. **Display session titles** at the top of active chat sessions
2. **Show "New Chat" as default** before the AI generates a session title
3. **Allow users to edit session titles** directly from the chat interface

## Current State Analysis

### Session Title Generation
- Session titles are **automatically generated** by AI providers after the 1st or 3rd user message
- Generated using `provider.generate_session_name()` with 4-word limit prompts
- Stored in `SessionMetadata.description` field in session files
- Default title patterns:
  - New sessions: `"New Chat"` (UI), `"CLI Session - {id}"` (CLI)
  - Resumed sessions: Uses `metadata.description` or falls back to `"ID: {session_id}"`
  - Continued sessions: `"Continued from {original_session_id}"`

### Current UI Structure
- **BaseChat.tsx**: Core chat component with `renderHeader()` customization point
- **AgentHeader.tsx**: Existing header component for recipe/agent titles (with green indicator)
- Session titles currently appear only in:
  - Session lists/history views
  - Window titles
  - **NOT in active chat interface**

### Existing Metadata Update Infrastructure
- `goose::session::update_metadata()` function available
- Used in project management routes for updating `project_id`
- **No public API endpoint** currently exists for general session metadata updates

## Implementation Plan

### Phase 1: Backend API Enhancement

#### 1.1 New API Endpoint
**File**: `crates/goose-server/src/routes/session.rs`

Add new endpoint for updating session metadata:
```rust
#[utoipa::path(
    put,
    path = "/sessions/{session_id}/metadata",
    request_body = UpdateSessionMetadataRequest,
    responses(
        (status = 200, description = "Session metadata updated successfully"),
        (status = 404, description = "Session not found"),
        (status = 401, description = "Unauthorized")
    )
)]
async fn update_session_metadata(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(session_id): Path<String>,
    Json(payload): Json<UpdateSessionMetadataRequest>,
) -> Result<StatusCode, StatusCode>
```

#### 1.2 Request/Response Types
```rust
#[derive(Deserialize, ToSchema)]
pub struct UpdateSessionMetadataRequest {
    pub description: Option<String>,
    // Allow future expansion for other metadata fields
}
```

#### 1.3 Enhanced Session Metadata Structure
**File**: `crates/goose/src/session/storage.rs`

Add new field to track custom titles:
```rust
pub struct SessionMetadata {
    pub description: String,
    pub is_title_customized: bool, // New field to prevent AI override
    // ... existing fields
}
```

#### 1.4 Update AI Generation Logic
**File**: `crates/goose/src/session/storage.rs`

Modify session description generation to respect custom titles:
```rust
// In save_messages function around line 1092-1104
if user_message_count < 4 && !metadata.is_title_customized {
    // Only generate AI description if not customized by user
    generate_description_with_schedule_id(...)
} else {
    // Preserve existing metadata without AI generation
    save_messages_with_metadata(&secure_path, &metadata, messages)
}
```

#### 1.5 Update Route Configuration
Add route to `session.rs` router and update OpenAPI schema.

### Phase 2: Frontend API Integration

#### 2.1 API Client Updates
**File**: `ui/desktop/src/api/`

Add TypeScript types and API function:
```typescript
export interface UpdateSessionMetadataRequest {
  description?: string;
}

export const updateSessionMetadata = async (
  sessionId: string, 
  data: UpdateSessionMetadataRequest
): Promise<void> => {
  // Implementation using generated API client
}
```

Update TypeScript types to include custom title flag:
```typescript
// Update existing SessionMetadata type
export type SessionMetadata = {
  description: string;
  is_title_customized?: boolean; // New field
  // ... existing fields
};
```

#### 2.2 Session Title Hook
**File**: `ui/desktop/src/hooks/useSessionTitle.ts`

Create dedicated hook for session title management:
```typescript
export const useSessionTitle = (
  sessionId: string, 
  initialTitle: string,
  isCustomTitle: boolean = false
) => {
  const [title, setTitle] = useState(initialTitle);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isCustom, setIsCustom] = useState(isCustomTitle);
  
  const updateTitle = async (newTitle: string) => {
    try {
      setIsSaving(true);
      // API call to update session metadata with is_title_customized: true
      await updateSessionMetadata(sessionId, { 
        description: newTitle,
        is_title_customized: true 
      });
      setTitle(newTitle);
      setIsCustom(true);
      setIsEditing(false);
    } catch (error) {
      // Error handling - revert to previous title
      console.error('Failed to update title:', error);
    } finally {
      setIsSaving(false);
    }
  };
  
  // Prevent external metadata updates from overwriting local changes
  useEffect(() => {
    if (!isEditing && !isSaving) {
      setTitle(initialTitle);
    }
  }, [initialTitle, isEditing, isSaving]);
  
  return {
    title,
    isEditing,
    isSaving,
    isCustom,
    updateTitle,
    startEditing: () => setIsEditing(true),
    cancelEditing: () => {
      setTitle(initialTitle);
      setIsEditing(false);
    }
  };
};
```

### Phase 3: UI Components

#### 3.1 Session Title Header Component
**File**: `ui/desktop/src/components/SessionTitleHeader.tsx`

Create new component for displaying and editing session titles:
```typescript
interface SessionTitleHeaderProps {
  sessionId: string;
  initialTitle: string;
  onTitleChange: (newTitle: string) => void;
  showBorder?: boolean;
}

export function SessionTitleHeader({
  sessionId,
  initialTitle,
  onTitleChange,
  showBorder = false
}: SessionTitleHeaderProps) {
  const {
    title,
    isEditing,
    isSaving,
    updateTitle,
    startEditing,
    cancelEditing
  } = useSessionTitle(sessionId, initialTitle);
  
  // Render logic:
  // - Display mode: title with edit button/icon
  // - Edit mode: input field with save/cancel buttons
  // - Loading state during save
  // - Error handling
}
```

**Design specifications**:
- Similar styling to `AgentHeader` but for session titles
- Inline editing with smooth transitions
- Edit trigger: Click on title or edit icon
- Save: Enter key or save button
- Cancel: Escape key or cancel button
- Visual feedback for saving state

#### 3.2 BaseChat Integration
**File**: `ui/desktop/src/components/BaseChat.tsx`

Integrate session title header into chat layout:
```typescript
// Add to BaseChatContent component around line 356-372
{/* Session title header - above recipe header */}
{!recipeConfig?.title && (
  <div className="sticky top-0 z-10 bg-background-default px-0 -mx-6 mb-6 pt-6">
    <SessionTitleHeader
      sessionId={chat.id}
      initialTitle={chat.title}
      onTitleChange={(newTitle) => {
        setChat({ ...chat, title: newTitle });
      }}
      showBorder={true}
    />
  </div>
)}

{/* Recipe agent header - sticky at top of chat container */}
{recipeConfig?.title && (
  <div className="sticky top-0 z-10 bg-background-default px-0 -mx-6 mb-6 pt-6">
    <AgentHeader
      title={recipeConfig.title}
      // ... existing props
    />
  </div>
)}
```

**Logic**:
- Show session title header when NO recipe is active
- Show recipe header when recipe IS active
- Session title takes precedence in display hierarchy

### Phase 4: Chat State Management

#### 4.1 Update Chat Title Logic
**Files**: 
- `ui/desktop/src/hooks/useChat.ts`
- `ui/desktop/src/hooks/useSessionContinuation.ts`
- `ui/desktop/src/App.tsx` (PairRouteWrapper)

**Current behavior updates**:
- Ensure "New Chat" appears immediately for new sessions
- Update title when AI generates session description
- Preserve custom titles when set by user
- Handle title updates during session continuation

**Session Resumption Updates**:
```typescript
// In useChat.ts and App.tsx PairRouteWrapper
const sessionChat = {
  id: sessionDetails.session_id,
  title: sessionDetails.metadata?.description || `ID: ${sessionDetails.session_id}`,
  isCustomTitle: sessionDetails.metadata?.is_title_customized || false,
  messages: sessionDetails.messages,
  messageHistoryIndex: sessionDetails.messages.length,
  recipeConfig: null,
};
```

#### 4.2 Title Synchronization
Ensure session titles are synchronized between:
- Local chat state (`chat.title`)
- Session metadata (`metadata.description`)
- Backend session files
- Session lists/history views

### Phase 5: UX Enhancements

#### 5.1 Visual Design
- **Default state**: "New Chat" in muted color
- **Generated title**: Regular text color
- **Custom title**: Bold or distinct styling
- **Edit mode**: Input field with focus styling
- **Saving state**: Loading indicator

#### 5.2 User Experience Flow
1. **New session**: Shows "New Chat"
2. **After 1st/3rd message**: AI generates title, replaces "New Chat"
3. **User edits**: Click to edit, type new title, save
4. **Custom title**: Persists through session, prevents AI overrides
5. **Session continuation**: Maintains custom title or inherits from parent

#### 5.3 Error Handling
- Network errors during save
- Validation errors (empty title, too long)
- Fallback to previous title on error
- Toast notifications for success/error states

### Phase 6: Testing Strategy

#### 6.1 Unit Tests
- `useSessionTitle` hook functionality
- `SessionTitleHeader` component rendering states
- API integration tests

#### 6.2 Integration Tests
- End-to-end title editing flow
- Session continuation with custom titles
- Recipe vs session title display logic

#### 6.3 Manual Testing Scenarios
- New session → AI generates title → User edits → Persists
- Recipe activation → Session title hidden → Recipe ends → Session title shown
- Session continuation → Custom title preserved
- Network interruption during save
- **Session resumption scenarios**:
  - Resume session with AI-generated title → Continue chat → AI should not regenerate title
  - Resume session with custom title → Title should persist
  - Resume session → Edit title → Resume again → Custom title should persist
  - Resume session → Continue conversation → Title should not change unexpectedly

## Implementation Sequence

### Sprint 1: Backend Foundation
1. ✅ Analyze current session metadata system
2. 🔄 Add `is_title_customized` field to SessionMetadata struct
3. 🔄 Update AI generation logic to respect custom titles
4. 🔄 Add `/sessions/{id}/metadata` PUT endpoint
5. 🔄 Update OpenAPI schema and TypeScript types

### Sprint 2: Core UI Components
1. 🔄 Update TypeScript types for custom title flag
2. 🔄 Create `useSessionTitle` hook with resumption handling
3. 🔄 Build `SessionTitleHeader` component
4. 🔄 Integrate with `BaseChat` component

### Sprint 3: State Management & UX
1. 🔄 Update session resumption logic in useChat and App.tsx
2. 🔄 Update chat state management for title sync
3. 🔄 Implement edit mode UX with validation
4. 🔄 Add error handling and loading states
5. 🔄 Prevent metadata conflicts during active sessions

### Sprint 4: Polish & Testing
1. 🔄 Visual design refinements
2. 🔄 Comprehensive testing
3. 🔄 Documentation updates

## Technical Considerations

### Performance
- Debounce title updates to avoid excessive API calls
- Optimistic updates for better UX
- Cache session metadata to reduce re-fetching

### Accessibility
- Proper ARIA labels for edit mode
- Keyboard navigation support
- Screen reader announcements for title changes

### Security
- Input validation and sanitization
- Rate limiting on metadata updates
- Maintain existing session file security

### Session Resumption Considerations
**Critical**: When users resume sessions from history, several important factors must be handled:

#### 1. Title Source Priority
- **AI-generated descriptions**: From `session.metadata.description`
- **User-customized titles**: Should override AI generation permanently
- **Fallback titles**: `"ID: {session_id}"` when no description exists
- Need to distinguish between these three states

#### 2. Prevent AI Override of Custom Titles
- Current behavior: AI regenerates session descriptions after 1st/3rd user message
- **Problem**: This could overwrite user-customized titles during resumed sessions
- **Solution**: Add `is_title_customized` flag to session metadata
- **Logic**: Only allow AI generation if `!metadata.is_title_customized`

#### 3. Session Metadata Synchronization
- `useMessageStream` automatically refreshes session metadata after each message
- **Risk**: Could overwrite local title changes with server metadata
- **Solution**: Component should track local editing state and prevent unwanted overwrites
- **Approach**: Use optimistic updates with conflict resolution

#### 4. Multiple Resume Paths
- **URL parameter**: `?resumeSessionId=xyz` (via `useChat` hook)
- **Navigation state**: Via session lists/insights (via `PairRouteWrapper`)
- Both paths must respect custom titles consistently
- Ensure `chat.title` initialization handles custom title flags

### Future Extensibility
- API designed to support other metadata fields
- Component structure allows for additional title features
- Hook pattern enables reuse in other contexts

## Success Criteria

1. ✅ **Display**: Session titles appear at the top of active chats
2. ✅ **Default**: "New Chat" shows before AI generation
3. ✅ **Edit**: Users can click to edit titles inline
4. ✅ **Persist**: Custom titles save and sync across app
5. ✅ **Coexist**: Works alongside recipe headers without conflict
6. ✅ **Performance**: No noticeable lag in title operations
7. ✅ **Polish**: Smooth animations and error handling 