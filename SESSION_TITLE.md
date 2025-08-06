# Session Title Implementation Plan (Simplified)

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

## Simplified Implementation Plan

### Phase 1: Backend Foundation (1 week)

#### 1.1 Enhanced Session Metadata Structure
**File**: `crates/goose/src/session/storage.rs`

Add simple field to track custom titles:
```rust
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct SessionMetadata {
    /// Working directory for the session
    pub working_dir: PathBuf,
    
    /// A short description of the session, typically 3 words or less
    pub description: String,
    
    /// Whether the title was customized by user (prevents AI override)
    #[serde(default)]
    pub is_title_customized: bool,
    
    // ... existing fields
}
```

#### 1.2 Simple Title Update API Endpoint
**File**: `crates/goose-server/src/routes/session.rs`

```rust
#[derive(Deserialize, ToSchema)]
pub struct UpdateSessionTitleRequest {
    pub title: String,
}

#[utoipa::path(
    put,
    path = "/sessions/{session_id}/title",
    request_body = UpdateSessionTitleRequest,
    responses(
        (status = 200, description = "Session title updated successfully"),
        (status = 404, description = "Session not found"),
        (status = 401, description = "Unauthorized")
    )
)]
async fn update_session_title(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(session_id): Path<String>,
    Json(payload): Json<UpdateSessionTitleRequest>,
) -> Result<StatusCode, StatusCode> {
    verify_secret_key(&headers, &state)?;

    let session_path = session::get_path(session::Identifier::Name(session_id))
        .map_err(|_| StatusCode::NOT_FOUND)?;

    let mut metadata = session::read_metadata(&session_path)
        .map_err(|_| StatusCode::NOT_FOUND)?;

    // Update title and mark as customized
    metadata.description = payload.title;
    metadata.is_title_customized = true;

    // Async update to avoid blocking
    let session_path_clone = session_path.clone();
    let metadata_clone = metadata.clone();
    tokio::task::spawn(async move {
        if let Err(e) = session::update_metadata(&session_path_clone, &metadata_clone).await {
            tracing::error!("Failed to update session metadata: {}", e);
        }
    });

    Ok(StatusCode::OK)
}
```

#### 1.3 AI Generation Logic Update
**File**: `crates/goose/src/session/storage.rs`

```rust
// In save_messages function around line 1092-1104
let should_generate_title = user_message_count < 4 
    && !metadata.is_title_customized 
    && metadata.description == "New Chat"; // Only for truly new sessions

if provider.is_some() && should_generate_title {
    generate_description_with_schedule_id(...)
} else {
    // Preserve existing metadata without AI generation
    save_messages_with_metadata(&secure_path, &metadata, messages)
}
```

#### 1.4 Update Route Configuration
Add route to session.rs router and update OpenAPI schema.

### Phase 2: Frontend Components (1 week)

#### 2.1 Session Title Component
**File**: `ui/desktop/src/components/SessionTitle.tsx`

Single component handling both display and editing:
```typescript
interface SessionTitleProps {
  sessionId: string;
  initialTitle: string;
  onTitleChange?: (newTitle: string) => void;
  className?: string;
}

export function SessionTitle({
  sessionId,
  initialTitle,
  onTitleChange,
  className = '',
}: SessionTitleProps) {
  const [title, setTitle] = useState(initialTitle);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editValue, setEditValue] = useState(title);

  // Sync with prop changes
  useEffect(() => {
    if (!isEditing) {
      setTitle(initialTitle);
    }
  }, [initialTitle, isEditing]);

  // Basic validation
  const isValid = editValue.trim().length > 0 && editValue.length <= 100;

  const handleSave = async () => {
    if (!isValid) return;
    
    setIsSaving(true);
    setError(null);
    
    try {
      const response = await fetch(`/api/sessions/${sessionId}/title`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: editValue.trim() }),
      });

      if (!response.ok) {
        throw new Error('Failed to save title');
      }

      const newTitle = editValue.trim();
      setTitle(newTitle);
      setIsEditing(false);
      onTitleChange?.(newTitle);
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setEditValue(title);
    setIsEditing(false);
    setError(null);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && isValid) {
      handleSave();
    } else if (e.key === 'Escape') {
      handleCancel();
    }
  };

  const startEditing = () => {
    setEditValue(title);
    setIsEditing(true);
    setError(null);
  };

  if (isEditing) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <input
          type="text"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={handleKeyDown}
          className={`
            flex-1 px-2 py-1 border rounded text-xl font-light
            ${isValid ? 'border-gray-300' : 'border-red-300'}
            focus:outline-none focus:ring-2 focus:ring-blue-500
          `}
          placeholder="Enter session title..."
          maxLength={100}
          autoFocus
        />
        <button
          onClick={handleSave}
          disabled={!isValid || isSaving}
          className="px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
        >
          {isSaving ? 'Saving...' : 'Save'}
        </button>
        <button
          onClick={handleCancel}
          disabled={isSaving}
          className="px-3 py-1 text-sm bg-gray-500 text-white rounded hover:bg-gray-600 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-2 group ${className}`}>
      <span
        className={`
          text-xl font-light cursor-pointer
          ${title === 'New Chat' ? 'text-gray-500 italic' : 'text-gray-900'}
        `}
        onClick={startEditing}
        title="Click to edit"
      >
        {title}
      </span>
      <button
        onClick={startEditing}
        className="opacity-0 group-hover:opacity-100 p-1 hover:bg-gray-100 rounded"
      >
        <PencilIcon className="w-4 h-4 text-gray-500" />
      </button>
      {error && (
        <div className="text-red-500 text-sm">
          {error}
        </div>
      )}
    </div>
  );
}
```

#### 2.2 BaseChat Integration
**File**: `ui/desktop/src/components/BaseChat.tsx`

```typescript
// Around line 356-372, replace the existing header logic:
{/* Session or Recipe Header - mutually exclusive */}
{recipeConfig?.title ? (
  // Recipe header takes precedence
  <div className="sticky top-0 z-10 bg-background-default px-0 -mx-6 mb-6 pt-6">
    <AgentHeader
      title={recipeConfig.title}
      profileInfo={
        recipeConfig.profile
          ? `${recipeConfig.profile} - ${recipeConfig.mcps || 12} MCPs`
          : undefined
      }
      onChangeProfile={() => console.log('Change profile clicked')}
      showBorder={true}
    />
  </div>
) : (
  // Session header when no recipe active
  <div className="sticky top-0 z-10 bg-background-default px-0 -mx-6 mb-6 pt-6">
    <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
      <SessionTitle
        sessionId={chat.id}
        initialTitle={chat.title}
        onTitleChange={(newTitle) => {
          setChat(prev => ({ ...prev, title: newTitle }));
        }}
        className="flex-1"
      />
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <span className="w-2 h-2 rounded-full bg-blue-500" />
        <span>Active Session</span>
      </div>
    </div>
  </div>
)}
```

### Phase 3: Integration (0.5 weeks)

#### 3.1 Session Resumption Updates
**Files**: `ui/desktop/src/hooks/useChat.ts`, `ui/desktop/src/App.tsx`

```typescript
// In both session resumption paths:
const sessionChat = {
  id: sessionDetails.session_id,
  title: sessionDetails.metadata?.description || `ID: ${sessionDetails.session_id}`,
  messages: sessionDetails.messages,
  messageHistoryIndex: sessionDetails.messages.length,
  recipeConfig: null,
};
```

#### 3.2 Metadata Sync with useMessageStream
**File**: `ui/desktop/src/hooks/useMessageStream.ts`

```typescript
// In the metadata update section (around line 403-419):
if (sessionResponse.data?.metadata) {
  const metadata = sessionResponse.data.metadata;
  
  setSessionMetadata({
    workingDir: metadata.working_dir,
    description: metadata.description,
    // ... other fields
  });
  
  // Update chat title only if not currently editing
  // (Basic protection against overwriting user edits)
  if (metadata.description !== chat.title) {
    setChat(prev => ({ ...prev, title: metadata.description }));
  }
}
```

## Testing Strategy

### Manual Testing Scenarios
1. **New session** → Shows "New Chat" → AI generates title → User edits → Persists
2. **Recipe activation** → Session title hidden → Recipe ends → Session title shown  
3. **Session resumption** → Custom title persists → Continue conversation → AI doesn't override
4. **Network failure** → Save fails → Error shown → User can retry by editing again
5. **Session continuation** → Custom title preserved

### Basic Unit Tests
- Component rendering in display/edit modes
- Title validation logic
- Save/cancel functionality

## Technical Considerations

### Performance
- **API calls**: Direct fetch, no debouncing needed (user explicitly saves)
- **Memory**: No global state, just local component state
- **Bundle size**: Single component, minimal overhead

### Security
- **Input validation**: 100 character limit, trim whitespace
- **Authentication**: Use existing session auth patterns
- **XSS prevention**: React automatically escapes text content

### Error Handling
- **Network errors**: Show error message, allow manual retry
- **Validation errors**: Visual feedback for invalid input
- **Fallback**: On any error, user can edit again

## Implementation Sequence

### Sprint 1: Backend (1 week)
1. ✅ Analyze current session metadata system
2. 🔄 Add `is_title_customized` field to SessionMetadata struct
3. 🔄 Add simple PUT `/sessions/{id}/title` endpoint  
4. 🔄 Update AI generation logic to respect custom titles
5. 🔄 Update OpenAPI schema

### Sprint 2: Frontend (1 week)
1. 🔄 Create SessionTitle component with inline editing
2. 🔄 Integrate with BaseChat component
3. 🔄 Update session resumption logic
4. 🔄 Basic component testing

### Sprint 3: Polish (0.5 weeks)
1. 🔄 Manual testing and bug fixes
2. 🔄 Documentation updates
3. 🔄 Deployment preparation

## Detailed Commit Breakdown

### **Phase 1: Backend Foundation (4-5 commits)**

#### Commit 1: `feat(session): add is_title_customized field to SessionMetadata`
**Files**: `crates/goose/src/session/storage.rs`
- Add `#[serde(default)] pub is_title_customized: bool` to SessionMetadata struct
- Update any metadata initialization to set default value
- **Why separate**: Pure data model change, easy to review, no breaking changes

#### Commit 2: `feat(session): prevent AI title generation for customized sessions`
**Files**: `crates/goose/src/session/storage.rs`
- Modify `save_messages` function to check `is_title_customized` flag
- Add logic: only generate if `user_message_count < 4 && !metadata.is_title_customized && metadata.description == "New Chat"`
- **Why separate**: Core business logic change, needs careful review

#### Commit 3: `feat(api): add session title update endpoint`
**Files**: 
- `crates/goose-server/src/routes/session.rs`
- Update OpenAPI schema files
- Add `UpdateSessionTitleRequest` struct
- Add `update_session_title` function
- **Why separate**: New API surface, needs API review and testing

#### Commit 4: `feat(api): register session title route`
**Files**: `crates/goose-server/src/routes/session.rs` (route registration)
- Add route to router configuration
- Update any route documentation
- **Why separate**: Infrastructure change, easy to verify routing works

#### Commit 5: `test(session): add backend tests for title functionality`
**Files**: Test files for session metadata and API endpoints
- Unit tests for AI generation prevention logic
- API endpoint tests for title updates
- **Why separate**: Can be done in parallel with frontend work

### **Phase 2: Frontend Component (2-3 commits)**

#### Commit 6: `feat(ui): add SessionTitle component`
**Files**: `ui/desktop/src/components/SessionTitle.tsx`
- Complete SessionTitle component with display/edit modes
- Include all state management, validation, API calls
- **Why separate**: Self-contained component, easy to review and test in isolation

#### Commit 7: `feat(ui): integrate SessionTitle with BaseChat`
**Files**: `ui/desktop/src/components/BaseChat.tsx`
- Add session header when no recipe active
- Implement mutual exclusion with recipe headers
- Update chat state on title changes
- **Why separate**: UI integration change, needs visual verification

#### Commit 8: `test(ui): add SessionTitle component tests`
**Files**: Component test files
- Unit tests for component rendering and interactions
- **Why separate**: Can be done in parallel, keeps main component commit focused

### **Phase 3: Integration (2 commits)**

#### Commit 9: `feat(session): preserve custom titles on resumption`
**Files**: 
- `ui/desktop/src/hooks/useChat.ts`
- `ui/desktop/src/App.tsx` (PairRouteWrapper)
- Update session resumption to handle custom titles properly
- **Why separate**: Critical integration point, needs careful testing

#### Commit 10: `feat(session): sync metadata updates with title display`
**Files**: `ui/desktop/src/hooks/useMessageStream.ts`
- Add basic protection against overwriting user edits
- Update chat title from metadata when appropriate
- **Why separate**: Complex interaction between metadata sync and UI state

### **Phase 4: Polish (1-2 commits)**

#### Commit 11: `fix: address session title edge cases and improvements`
**Files**: Various files based on testing
- Bug fixes discovered during testing
- Minor UX improvements
- **Why separate**: Cleanup commit after integration testing

#### Optional Commit 12: `docs: update session title functionality documentation`
**Files**: Documentation files
- Update any relevant docs about session functionality
- **Why separate**: Non-functional change, can be done last

## **Commit Strategy Benefits**

### 🟢 **Incremental Safety**
- Each commit is independently reviewable
- Backend changes land first (safer)
- UI changes build on stable backend
- Easy to revert specific changes if needed

### 🟢 **Parallel Development** 
- Tests can be written in parallel with main features
- Multiple developers can work on different commits
- Frontend can start once backend API is merged

### 🟢 **Review Efficiency**
- Small, focused commits are easier to review thoroughly
- Clear separation of concerns
- Business logic separated from UI changes

### 🟢 **Risk Management**
- Data model changes land first and can be tested
- API endpoints can be tested independently
- UI integration is last major risk point

## Success Criteria

### Functional Requirements
1. ✅ **Display**: Session titles appear at top of active chats
2. ✅ **Default**: "New Chat" shows before AI generation
3. ✅ **Edit**: Users can edit titles with visual feedback
4. ✅ **Persist**: Custom titles survive all session operations
5. ✅ **Coexist**: Works alongside recipe headers without conflict

### Non-Functional Requirements
6. ✅ **Performance**: <200ms for title operations
7. ✅ **Reliability**: Basic error handling with manual retry
8. ✅ **Data Safety**: No data loss during title updates
9. ✅ **User Experience**: Intuitive editing, clear error messages

### Acceptance Criteria
- All existing sessions work without migration (serde defaults handle missing fields)
- Title editing works with basic error handling
- Custom titles never get overridden by AI
- No performance impact on chat loading
- Simple, maintainable codebase 