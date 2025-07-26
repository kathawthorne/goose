import { useState, useCallback, useEffect } from 'react';
import { updateSession, getSessionHistory } from '../api/sdk.gen';

interface UseSessionTitleProps {
  sessionId: string;
  initialTitle: string;
}

interface UseSessionTitleReturn {
  title: string;
  updateTitle: (newTitle: string) => Promise<void>;
  isUpdating: boolean;
  error: string | null;
}

export const useSessionTitle = ({ 
  sessionId, 
  initialTitle 
}: UseSessionTitleProps): UseSessionTitleReturn => {
  const [title, setTitle] = useState(initialTitle);
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasLoadedFromAPI, setHasLoadedFromAPI] = useState(false);

  // Update title when initialTitle changes (e.g., when session metadata loads)
  // But only update if we get a non-empty title, and don't reset to empty
  useEffect(() => {
    if (initialTitle && initialTitle.trim() !== '') {
      setTitle(initialTitle);
      setHasLoadedFromAPI(true);
    }
  }, [initialTitle]);

  // If we don't have a title from metadata, try to fetch it directly from the API
  useEffect(() => {
    const fetchSessionTitle = async () => {
      if (!hasLoadedFromAPI && sessionId && (!initialTitle || initialTitle.trim() === '')) {
        try {
          const response = await getSessionHistory({ path: { session_id: sessionId } });
          if (response.data?.metadata?.description) {
            setTitle(response.data.metadata.description);
            setHasLoadedFromAPI(true);
          }
        } catch (err) {
          console.warn('Failed to fetch session title:', err);
          // Don't set error state for this, as it's just a fallback
        }
      }
    };

    fetchSessionTitle();
  }, [sessionId, initialTitle, hasLoadedFromAPI]);

  const updateTitle = useCallback(async (newTitle: string) => {
    setIsUpdating(true);
    setError(null);

    try {
      await updateSession({
        path: { session_id: sessionId },
        body: { description: newTitle }
      });
      setTitle(newTitle);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to update session title';
      setError(errorMessage);
      throw err; // Re-throw so EditableTitle can handle it
    } finally {
      setIsUpdating(false);
    }
  }, [sessionId]);

  return {
    title,
    updateTitle,
    isUpdating,
    error,
  };
};
