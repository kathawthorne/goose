import { useState, useCallback, useEffect, useRef } from 'react';
import { updateSession, getSessionHistory } from '../api/sdk.gen';
import { Message } from '../types/message';

// Helper function to manage local storage for manually edited flags
const getManualEditKey = (sessionId: string) => `goose_manual_edit_${sessionId}`;

const isSessionManuallyEdited = (sessionId: string): boolean => {
  try {
    const stored = localStorage.getItem(getManualEditKey(sessionId));
    return stored === 'true';
  } catch {
    return false;
  }
};

const setSessionManuallyEdited = (sessionId: string, isManual: boolean): void => {
  try {
    if (isManual) {
      localStorage.setItem(getManualEditKey(sessionId), 'true');
    } else {
      localStorage.removeItem(getManualEditKey(sessionId));
    }
  } catch (error) {
    console.warn('Failed to update manual edit flag in localStorage:', error);
  }
};

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
  const [hasExistingTitle, setHasExistingTitle] = useState(false);
  const [isStabilized, setIsStabilized] = useState(false);
  const [isManuallyEdited, setIsManuallyEdited] = useState(false);

  // Refs to track async operations and prevent race conditions
  const currentSessionIdRef = useRef<string | null>(null);
  const initializationPromiseRef = useRef<Promise<void> | null>(null);
  const isInitializedRef = useRef(false);

  // Cleanup function to reset initialization state
  const cleanup = useCallback(() => {
    initializationPromiseRef.current = null;
  }, []);

  // Reset all state when sessionId changes
  useEffect(() => {
    if (sessionId !== currentSessionIdRef.current) {
      console.log('Session ID changed, resetting title state:', {
        oldId: currentSessionIdRef.current,
        newId: sessionId,
        initialTitle,
      });

      // Cancel any ongoing operations
      cleanup();

      // Reset all state
      setTitle('');
      setIsUpdating(false);
      setIsAutoGenerating(false);
      setError(null);
      setHasExistingTitle(false);
      setIsStabilized(false);

      // Load the manual edit flag from localStorage for the new session
      const wasManuallyEdited = isSessionManuallyEdited(sessionId);
      setIsManuallyEdited(wasManuallyEdited);
      console.log('Loaded manual edit flag for session', sessionId, ':', wasManuallyEdited);

      isInitializedRef.current = false;

      // Update current session ref
      currentSessionIdRef.current = sessionId;

      // If we have an initialTitle immediately available, use it to prevent flash
      // But only if the session was not manually edited
      if (initialTitle && initialTitle.trim() !== '' && !wasManuallyEdited) {
        console.log('Setting initial title immediately to prevent flash:', initialTitle);
        setTitle(initialTitle);
        setHasExistingTitle(true);
        setIsStabilized(true);
        isInitializedRef.current = true;
      }
    }
  }, [sessionId, initialTitle, cleanup]);

  // Initialize title from initialTitle or fetch from API
  useEffect(() => {
    // Only run if we haven't initialized yet or if initialTitle changed for current session
    if (sessionId !== currentSessionIdRef.current || isInitializedRef.current) {
      return;
    }

    const initializeTitle = async () => {
      // Check if this session is still current
      if (sessionId !== currentSessionIdRef.current) {
        return;
      }

      try {
        // Check if this session was manually edited
        const wasManuallyEdited = isSessionManuallyEdited(sessionId);

        // If we have an initialTitle (from session metadata), use it immediately
        // But only if the session was not manually edited
        if (initialTitle && initialTitle.trim() !== '' && !wasManuallyEdited) {
          // Only update if we're not stabilized
          if (!isStabilized) {
            console.log('Using initialTitle for session', sessionId, ':', initialTitle);
            if (sessionId === currentSessionIdRef.current) {
              setTitle(initialTitle);
              setHasExistingTitle(true);
              setIsStabilized(true);
              isInitializedRef.current = true;
            }
          }
          return;
        }

        // If session was manually edited, try to get the current title from the API
        if (wasManuallyEdited && sessionId && sessionId !== 'new') {
          console.log(
            'Session was manually edited, fetching current title from API for session:',
            sessionId
          );
          const response = await getSessionHistory({
            path: { session_id: sessionId },
          });

          // Check if this operation is still relevant (session might have changed during async call)
          if (sessionId !== currentSessionIdRef.current) {
            console.log('Session changed during API call, ignoring result');
            return;
          }

          if (response.data?.metadata?.description) {
            console.log(
              'Fetched manually edited title from API:',
              response.data.metadata.description
            );
            setTitle(response.data.metadata.description);
            setHasExistingTitle(true);
            setIsStabilized(true);
          } else {
            console.log('No title found in API response for manually edited session:', sessionId);
            setTitle('');
            setHasExistingTitle(false);
          }
          isInitializedRef.current = true;
          return;
        }

        // If no initialTitle but we have a sessionId, try to fetch from API
        if (sessionId && sessionId !== 'new') {
          console.log('Fetching title from API for session:', sessionId);
          const response = await getSessionHistory({
            path: { session_id: sessionId },
          });

          // Check if this operation is still relevant (session might have changed during async call)
          if (sessionId !== currentSessionIdRef.current) {
            console.log('Session changed during API call, ignoring result');
            return;
          }

          if (response.data?.metadata?.description) {
            console.log('Fetched title from API:', response.data.metadata.description);
            setTitle(response.data.metadata.description);
            setHasExistingTitle(true);
            setIsStabilized(true);
          } else {
            console.log('No title found in API response for session:', sessionId);
            setTitle('');
            setHasExistingTitle(false);
          }
        } else {
          // New session - no existing title
          console.log('New session, no existing title');
          setTitle('');
          setHasExistingTitle(false);
        }

        isInitializedRef.current = true;
      } catch (err) {
        console.warn('Failed to fetch session title from API:', err);
        if (sessionId === currentSessionIdRef.current) {
          setTitle('');
          setHasExistingTitle(false);
          isInitializedRef.current = true;
        }
      }
    };

    // Store the promise to prevent multiple concurrent initializations
    if (!initializationPromiseRef.current) {
      initializationPromiseRef.current = initializeTitle();
    }
  }, [sessionId, initialTitle, isStabilized]);

  const updateTitle = useCallback(
    async (newTitle: string) => {
      console.log('updateTitle called:', { sessionId, newTitle, currentTitle: title });

      // Prevent concurrent updates
      if (isUpdating) {
        console.log('Update already in progress, skipping');
        return;
      }

      setIsUpdating(true);
      setError(null);

      try {
        console.log('Calling updateSession API:', { sessionId, description: newTitle });
        await updateSession({
          path: { session_id: sessionId },
          body: { description: newTitle },
        });

        // Only update state if this is still the current session
        if (sessionId === currentSessionIdRef.current) {
          console.log('updateSession API successful, updating local state');
          setTitle(newTitle);
          setHasExistingTitle(true);
          setIsStabilized(true);
          setIsManuallyEdited(true);

          // Persist the manual edit flag to localStorage
          setSessionManuallyEdited(sessionId, true);

          console.log('Title update completed:', { newTitle, isManuallyEdited: true });
        }
      } catch (err) {
        console.error('updateSession API failed:', err);
        if (sessionId === currentSessionIdRef.current) {
          const errorMessage =
            err instanceof Error ? err.message : 'Failed to update session title';
          setError(errorMessage);
        }
        throw err; // Re-throw so EditableTitle can handle it
      } finally {
        if (sessionId === currentSessionIdRef.current) {
          setIsUpdating(false);
        }
      }
    },
    [sessionId, title, isUpdating]
  );

  // Auto-generate title from first message when it's added
  useEffect(() => {
    // Only auto-generate if we're initialized and meet all conditions
    if (
      !isInitializedRef.current ||
      sessionId !== currentSessionIdRef.current ||
      hasExistingTitle ||
      title ||
      isStabilized ||
      isManuallyEdited ||
      isAutoGenerating ||
      messages.length !== 1 ||
      messages[0]?.role !== 'user'
    ) {
      return;
    }

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

    if (!messageText.trim()) {
      return;
    }

    const generatedTitle = generateTitleFromMessage(messageText);
    if (!generatedTitle) {
      return;
    }

    console.log('Auto-generating title for session', sessionId, ':', generatedTitle);
    setIsAutoGenerating(true);

    // Auto-update the session title (this is NOT a manual edit)
    updateTitle(generatedTitle)
      .then(() => {
        // Only update state if this is still the current session
        if (sessionId === currentSessionIdRef.current) {
          setHasExistingTitle(true);
          setIsStabilized(true);
          // Important: Don't set isManuallyEdited to true for auto-generated titles
          setIsManuallyEdited(false);
          // Don't persist manual edit flag for auto-generated titles
          setSessionManuallyEdited(sessionId, false);
        }
      })
      .catch((err) => {
        console.warn('Failed to auto-generate session title:', err);
      })
      .finally(() => {
        if (sessionId === currentSessionIdRef.current) {
          setIsAutoGenerating(false);
        }
      });
  }, [
    sessionId,
    hasExistingTitle,
    title,
    isStabilized,
    isManuallyEdited,
    isAutoGenerating,
    messages,
    updateTitle,
  ]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  return {
    title,
    updateTitle,
    isUpdating,
    isAutoGenerating,
    error,
  };
};
