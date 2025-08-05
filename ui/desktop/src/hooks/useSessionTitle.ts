import { useState, useCallback, useEffect } from 'react';
import { updateSession, getSessionHistory } from '../api/sdk.gen';
import { Message } from '../types/message';

interface UseSessionTitleProps {
  sessionId: string;
  initialTitle: string;
  messages?: Message[]; // Use proper Message type instead of any
}

interface UseSessionTitleReturn {
  title: string;
  updateTitle: (newTitle: string) => Promise<void>;
  isUpdating: boolean;
  isAutoGenerating: boolean; // Add new state for auto-generation
  error: string | null;
}

// Helper function to generate a title from the first message
const generateTitleFromMessage = (messageText: string): string => {
  if (!messageText || messageText.trim() === '') {
    return '';
  }

  // Clean up the message text
  const cleanText = messageText.trim();

  // If it's short enough, use it as is (up to 50 characters)
  if (cleanText.length <= 50) {
    return cleanText;
  }

  // For longer messages, try to find a good breaking point
  const words = cleanText.split(' ');
  let title = '';

  for (const word of words) {
    if ((title + ' ' + word).length > 50) {
      break;
    }
    title = title ? title + ' ' + word : word;
  }

  // If we couldn't fit any words, just truncate
  if (!title) {
    title = cleanText.substring(0, 47) + '...';
  } else if (title.length < cleanText.length) {
    title += '...';
  }

  return title;
};

export const useSessionTitle = ({
  sessionId,
  initialTitle,
  messages = [],
}: UseSessionTitleProps): UseSessionTitleReturn => {
  const [title, setTitle] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);
  const [isAutoGenerating, setIsAutoGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSessionId, setLastSessionId] = useState<string | null>(null);
  const [hasExistingTitle, setHasExistingTitle] = useState(false);
  const [isStabilized, setIsStabilized] = useState(false); // Track if title has been stabilized
  const [isManuallyEdited, setIsManuallyEdited] = useState(false); // Track if title has been manually edited

  // Reset all state when sessionId changes
  useEffect(() => {
    if (sessionId !== lastSessionId && sessionId) {
      console.log('Session ID changed, resetting title state:', {
        oldId: lastSessionId,
        newId: sessionId,
        initialTitle,
      });

      // If we have an initialTitle immediately available, use it to prevent flash
      if (initialTitle && initialTitle.trim() !== '') {
        console.log('Setting initial title immediately to prevent flash:', initialTitle);
        setTitle(initialTitle);
        setHasExistingTitle(true);
        setIsStabilized(true); // Mark as stabilized since we have a real title
      } else {
        setTitle('');
        setHasExistingTitle(false);
        setIsStabilized(false);
      }

      setIsAutoGenerating(false);
      setIsManuallyEdited(false); // Reset manual edit flag for new session
      setError(null);
      setLastSessionId(sessionId);
    }
  }, [sessionId, lastSessionId, initialTitle]);

  // Initialize title from initialTitle or fetch from API
  useEffect(() => {
    const initializeTitle = async () => {
      // Skip if session ID hasn't been updated yet
      if (sessionId !== lastSessionId) {
        return;
      }

      // If we have an initialTitle (from session metadata), use it immediately
      if (initialTitle && initialTitle.trim() !== '') {
        // Only update if we're not stabilized AND not manually edited
        // Manual edits should take priority over any subsequent initialTitle changes
        if (!isStabilized && !isManuallyEdited) {
          console.log('Using initialTitle for session', sessionId, ':', initialTitle);
          setTitle(initialTitle);
          setHasExistingTitle(true);
          setIsStabilized(true);
        } else if (isManuallyEdited) {
          console.log('Skipping initialTitle update - title was manually edited:', {
            currentTitle: title,
            attemptedInitialTitle: initialTitle,
            sessionId,
          });
        } else {
          console.log('Skipping initialTitle update - title already stabilized:', {
            currentTitle: title,
            attemptedInitialTitle: initialTitle,
            sessionId,
          });
        }
        return;
      }

      // If no initialTitle but we have a sessionId, try to fetch from API
      if (sessionId && sessionId !== 'new') {
        try {
          console.log('Fetching title from API for session:', sessionId);
          const response = await getSessionHistory({ path: { session_id: sessionId } });
          if (response.data?.metadata?.description) {
            console.log('Fetched title from API:', response.data.metadata.description);
            setTitle(response.data.metadata.description);
            setHasExistingTitle(true);
          } else {
            console.log('No title found in API response for session:', sessionId);
            setTitle('');
            setHasExistingTitle(false);
          }
        } catch (err) {
          console.warn('Failed to fetch session title from API:', err);
          setTitle('');
          setHasExistingTitle(false);
        }
      } else {
        // New session - no existing title
        console.log('New session, no existing title');
        setTitle('');
        setHasExistingTitle(false);
      }
    };

    initializeTitle();
  }, [sessionId, lastSessionId, initialTitle, title, isStabilized, isManuallyEdited]);

  const updateTitle = useCallback(
    async (newTitle: string) => {
      console.log('updateTitle called:', { sessionId, newTitle, currentTitle: title });
      setIsUpdating(true);
      setError(null);

      try {
        console.log('Calling updateSession API:', { sessionId, description: newTitle });
        await updateSession({
          path: { session_id: sessionId },
          body: { description: newTitle },
        });
        console.log('updateSession API successful, updating local state');
        setTitle(newTitle);
        setHasExistingTitle(true); // Mark as having a title
        setIsStabilized(true); // Mark as stabilized after manual edit to prevent overrides
        setIsManuallyEdited(true); // Mark as manually edited to prevent future overrides
        console.log('Title update completed:', { newTitle, isManuallyEdited: true });
      } catch (err) {
        console.error('updateSession API failed:', err);
        const errorMessage = err instanceof Error ? err.message : 'Failed to update session title';
        setError(errorMessage);
        throw err; // Re-throw so EditableTitle can handle it
      } finally {
        setIsUpdating(false);
      }
    },
    [sessionId, title]
  );

  // Auto-generate title from first message when it's added
  useEffect(() => {
    // Only auto-generate if:
    // 1. Session ID is current
    // 2. We don't have an existing title
    // 3. We have exactly one message (the first user message)
    // 4. The message is from a user
    // 5. We haven't started auto-generating yet
    // 6. Title hasn't been stabilized from resumed session data
    if (
      sessionId === lastSessionId &&
      !hasExistingTitle &&
      !title &&
      !isStabilized &&
      messages.length === 1 &&
      messages[0]?.role === 'user' &&
      !isAutoGenerating
    ) {
      // Extract text content from the message
      const messageContent = messages[0]?.content;
      let messageText = '';

      if (Array.isArray(messageContent)) {
        // Find text content in the message content array
        const textContent = messageContent.find((c) => c.type === 'text');
        messageText = textContent?.text || '';
      } else if (typeof messageContent === 'string') {
        messageText = messageContent;
      }

      if (messageText.trim()) {
        const generatedTitle = generateTitleFromMessage(messageText);
        if (generatedTitle) {
          console.log('Auto-generating title for session', sessionId, ':', generatedTitle);
          // Set auto-generating state
          setIsAutoGenerating(true);

          // Auto-update the session title
          updateTitle(generatedTitle)
            .then(() => {
              setHasExistingTitle(true); // Mark as having a title now
              setIsStabilized(true); // Mark as stabilized after successful generation
            })
            .catch((err) => {
              console.warn('Failed to auto-generate session title:', err);
            })
            .finally(() => {
              setIsAutoGenerating(false);
            });
        }
      }
    }
  }, [
    sessionId,
    lastSessionId,
    hasExistingTitle,
    title,
    isStabilized,
    messages,
    isAutoGenerating,
    updateTitle,
  ]);

  return {
    title,
    updateTitle,
    isUpdating,
    isAutoGenerating,
    error,
  };
};
