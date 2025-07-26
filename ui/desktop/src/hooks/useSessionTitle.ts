import { useState, useCallback } from 'react';
import { updateSession } from '../api/sdk.gen';

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
