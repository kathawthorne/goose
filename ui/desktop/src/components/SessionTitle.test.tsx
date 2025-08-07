import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SessionTitle } from './SessionTitle';

// Mock the icons to avoid import issues
vi.mock('./icons', () => ({
  Edit: () => <div data-testid="edit-icon">✏️</div>,
}));

// Mock localStorage
const mockLocalStorage = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};

Object.defineProperty(window, 'localStorage', {
  value: mockLocalStorage,
});

// Mock fetch
globalThis.fetch = vi.fn();

describe('SessionTitle', () => {
  const defaultProps = {
    sessionId: 'test-session-123',
    initialTitle: 'Test Session Title',
    onTitleChange: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockLocalStorage.getItem.mockReturnValue('test-secret');
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('Display Mode', () => {
    it('renders the initial title correctly', () => {
      render(<SessionTitle {...defaultProps} />);

      expect(screen.getByText('Test Session Title')).toBeInTheDocument();
      expect(screen.getByTitle('Click to edit')).toBeInTheDocument();
    });

    it('shows edit icon on hover', () => {
      render(<SessionTitle {...defaultProps} />);

      const editButton = screen.getByRole('button');
      expect(editButton).toHaveClass('opacity-0');

      // Edit icon should be present
      expect(screen.getByTestId('edit-icon')).toBeInTheDocument();
    });

    it('applies special styling for "New Chat" title', () => {
      render(<SessionTitle {...defaultProps} initialTitle="New Chat" />);

      const titleSpan = screen.getByText('New Chat');
      expect(titleSpan).toHaveClass('text-textPlaceholder', 'italic');
    });

    it('applies normal styling for regular titles', () => {
      render(<SessionTitle {...defaultProps} />);

      const titleSpan = screen.getByText('Test Session Title');
      expect(titleSpan).toHaveClass('text-textStandard');
      expect(titleSpan).not.toHaveClass('text-textPlaceholder', 'italic');
    });

    it('applies custom className prop', () => {
      render(<SessionTitle {...defaultProps} className="custom-class" />);

      const container = screen.getByText('Test Session Title').closest('div');
      expect(container).toHaveClass('custom-class');
    });
  });

  describe('Edit Mode Activation', () => {
    it('enters edit mode when title is clicked', async () => {
      const user = userEvent.setup();
      render(<SessionTitle {...defaultProps} />);

      await user.click(screen.getByText('Test Session Title'));

      expect(screen.getByRole('textbox')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Test Session Title')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    });

    it('enters edit mode when edit button is clicked', async () => {
      const user = userEvent.setup();
      render(<SessionTitle {...defaultProps} />);

      await user.click(screen.getByRole('button'));

      expect(screen.getByRole('textbox')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Test Session Title')).toBeInTheDocument();
    });

    it('focuses and selects text when entering edit mode', async () => {
      const user = userEvent.setup();
      render(<SessionTitle {...defaultProps} />);

      await user.click(screen.getByText('Test Session Title'));

      const input = screen.getByRole('textbox') as HTMLInputElement;
      expect(input).toHaveFocus();
      expect(input.selectionStart).toBe(0);
      expect(input.selectionEnd).toBe(defaultProps.initialTitle.length);
    });
  });

  describe('Edit Mode Behavior', () => {
    it('allows text editing in edit mode', async () => {
      const user = userEvent.setup();
      render(<SessionTitle {...defaultProps} />);

      await user.click(screen.getByText('Test Session Title'));
      const input = screen.getByRole('textbox');

      await user.clear(input);
      await user.type(input, 'New Title');

      expect(input).toHaveValue('New Title');
    });

    it('shows validation state for valid input', async () => {
      const user = userEvent.setup();
      render(<SessionTitle {...defaultProps} />);

      await user.click(screen.getByText('Test Session Title'));
      const input = screen.getByRole('textbox');

      await user.clear(input);
      await user.type(input, 'Valid Title');

      expect(input).toHaveClass('border-border-strong');
      expect(input).not.toHaveClass('border-destructive');
      expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled();
    });

    it('shows validation state for invalid input (empty)', async () => {
      const user = userEvent.setup();
      render(<SessionTitle {...defaultProps} />);

      await user.click(screen.getByText('Test Session Title'));
      const input = screen.getByRole('textbox');

      await user.clear(input);

      expect(input).toHaveClass('border-destructive');
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    });

    it('enforces maximum length validation', async () => {
      const user = userEvent.setup();
      render(<SessionTitle {...defaultProps} />);

      await user.click(screen.getByText('Test Session Title'));
      const input = screen.getByRole('textbox');

      // Input should have maxLength attribute for browser enforcement
      expect(input).toHaveAttribute('maxLength', '100');

      // Test the validation logic with exactly 100 characters (valid)
      const exactlyValidTitle = 'a'.repeat(100);
      await user.clear(input);
      await user.type(input, exactlyValidTitle);
      expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled();

      // Test empty input (invalid)
      await user.clear(input);
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    });

    it('respects maxLength attribute', async () => {
      const user = userEvent.setup();
      render(<SessionTitle {...defaultProps} />);

      await user.click(screen.getByText('Test Session Title'));
      const input = screen.getByRole('textbox');

      expect(input).toHaveAttribute('maxLength', '100');
    });
  });

  describe('Save Functionality', () => {
    it('makes correct API call via Save button', async () => {
      const user = userEvent.setup();
      const mockFetch = vi.mocked(fetch);
      mockFetch.mockResolvedValueOnce({
        ok: true,
      } as Response);

      render(<SessionTitle {...defaultProps} />);

      await user.click(screen.getByText('Test Session Title'));
      const input = screen.getByRole('textbox');

      await user.clear(input);
      await user.type(input, 'Updated Title');
      await user.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith('/api/sessions/test-session-123/title', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'x-secret-key': 'test-secret',
          },
          body: JSON.stringify({ title: 'Updated Title' }),
        });
        expect(defaultProps.onTitleChange).toHaveBeenCalledWith('Updated Title');
        expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
      });
    });

    it('makes correct API call via Enter key', async () => {
      const user = userEvent.setup();
      const mockFetch = vi.mocked(fetch);
      mockFetch.mockResolvedValueOnce({
        ok: true,
      } as Response);

      render(<SessionTitle {...defaultProps} />);

      await user.click(screen.getByText('Test Session Title'));
      const input = screen.getByRole('textbox');

      await user.clear(input);
      await user.type(input, 'Keyboard Save');
      await user.keyboard('{Enter}');

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith('/api/sessions/test-session-123/title', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'x-secret-key': 'test-secret',
          },
          body: JSON.stringify({ title: 'Keyboard Save' }),
        });
        expect(defaultProps.onTitleChange).toHaveBeenCalledWith('Keyboard Save');
      });
    });

    it('shows loading state during save', async () => {
      const user = userEvent.setup();
      const mockFetch = vi.mocked(fetch);
      // Create a promise we can control
      let resolvePromise: (value: Response) => void;
      const pendingPromise = new Promise<Response>((resolve) => {
        resolvePromise = resolve;
      });
      mockFetch.mockReturnValueOnce(pendingPromise);

      render(<SessionTitle {...defaultProps} />);

      await user.click(screen.getByText('Test Session Title'));
      const input = screen.getByRole('textbox');

      await user.clear(input);
      await user.type(input, 'Loading Test');
      await user.click(screen.getByRole('button', { name: 'Save' }));

      // Should show loading state
      expect(screen.getByRole('button', { name: 'Saving...' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
      expect(input).toBeDisabled();

      // Resolve the promise
      resolvePromise!({ ok: true } as Response);

      await waitFor(() => {
        expect(screen.queryByRole('button', { name: 'Saving...' })).not.toBeInTheDocument();
      });
    });

    it('handles save errors gracefully', async () => {
      const user = userEvent.setup();
      const mockFetch = vi.mocked(fetch);
      mockFetch.mockResolvedValueOnce({
        ok: false,
      } as Response);

      render(<SessionTitle {...defaultProps} />);

      await user.click(screen.getByText('Test Session Title'));
      const input = screen.getByRole('textbox');

      await user.clear(input);
      await user.type(input, 'Error Test');
      await user.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() => {
        expect(screen.getByText('Failed to save title')).toBeInTheDocument();
      });

      // Should still be in edit mode
      expect(screen.getByRole('textbox')).toBeInTheDocument();
      expect(defaultProps.onTitleChange).not.toHaveBeenCalled();
    });

    it('trims whitespace from saved title', async () => {
      const user = userEvent.setup();
      const mockFetch = vi.mocked(fetch);
      mockFetch.mockResolvedValueOnce({
        ok: true,
      } as Response);

      render(<SessionTitle {...defaultProps} />);

      await user.click(screen.getByText('Test Session Title'));
      const input = screen.getByRole('textbox');

      await user.clear(input);
      await user.type(input, '  Trimmed Title  ');
      await user.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith('/api/sessions/test-session-123/title', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'x-secret-key': 'test-secret',
          },
          body: JSON.stringify({ title: 'Trimmed Title' }),
        });
        expect(defaultProps.onTitleChange).toHaveBeenCalledWith('Trimmed Title');
      });
    });
  });

  describe('Cancel Functionality', () => {
    it('cancels edit via Cancel button', async () => {
      const user = userEvent.setup();
      render(<SessionTitle {...defaultProps} />);

      await user.click(screen.getByText('Test Session Title'));
      const input = screen.getByRole('textbox');

      await user.clear(input);
      await user.type(input, 'Changed Text');
      await user.click(screen.getByRole('button', { name: 'Cancel' }));

      // Should exit edit mode and revert to original title
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
      expect(screen.getByText('Test Session Title')).toBeInTheDocument();
      expect(defaultProps.onTitleChange).not.toHaveBeenCalled();
    });

    it('cancels edit via Escape key', async () => {
      const user = userEvent.setup();
      render(<SessionTitle {...defaultProps} />);

      await user.click(screen.getByText('Test Session Title'));
      const input = screen.getByRole('textbox');

      await user.clear(input);
      await user.type(input, 'Changed Text');
      await user.keyboard('{Escape}');

      // Should exit edit mode and revert to original title
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
      expect(screen.getByText('Test Session Title')).toBeInTheDocument();
      expect(defaultProps.onTitleChange).not.toHaveBeenCalled();
    });

    it('clears error state when canceling', async () => {
      const user = userEvent.setup();
      const mockFetch = vi.mocked(fetch);
      mockFetch.mockResolvedValueOnce({
        ok: false,
      } as Response);

      render(<SessionTitle {...defaultProps} />);

      await user.click(screen.getByText('Test Session Title'));
      const input = screen.getByRole('textbox');

      await user.clear(input);
      await user.type(input, 'Error Test');
      await user.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() => {
        expect(screen.getByText('Failed to save title')).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(screen.queryByText('Failed to save title')).not.toBeInTheDocument();
    });
  });

  describe('Props Updates', () => {
    it('updates title when initialTitle prop changes (outside edit mode)', () => {
      const { rerender } = render(<SessionTitle {...defaultProps} />);

      expect(screen.getByText('Test Session Title')).toBeInTheDocument();

      rerender(<SessionTitle {...defaultProps} initialTitle="Updated Title" />);

      expect(screen.getByText('Updated Title')).toBeInTheDocument();
    });

    it('does not update title when initialTitle prop changes during edit mode', async () => {
      const user = userEvent.setup();
      const { rerender } = render(<SessionTitle {...defaultProps} />);

      await user.click(screen.getByText('Test Session Title'));
      const input = screen.getByRole('textbox');
      expect(input).toHaveValue('Test Session Title');

      // Change prop while in edit mode
      rerender(<SessionTitle {...defaultProps} initialTitle="Should Not Update" />);

      // Input should still have original value
      expect(input).toHaveValue('Test Session Title');
    });
  });

  describe('Error States', () => {
    it('handles network errors', async () => {
      const user = userEvent.setup();
      const mockFetch = vi.mocked(fetch);
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      render(<SessionTitle {...defaultProps} />);

      await user.click(screen.getByText('Test Session Title'));
      const input = screen.getByRole('textbox');

      await user.clear(input);
      await user.type(input, 'Network Test');
      await user.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() => {
        expect(screen.getByText('Network error')).toBeInTheDocument();
      });
    });

    it('handles unknown errors', async () => {
      const user = userEvent.setup();
      const mockFetch = vi.mocked(fetch);
      mockFetch.mockRejectedValueOnce('Unknown error');

      render(<SessionTitle {...defaultProps} />);

      await user.click(screen.getByText('Test Session Title'));
      const input = screen.getByRole('textbox');

      await user.clear(input);
      await user.type(input, 'Unknown Error Test');
      await user.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() => {
        expect(screen.getByText('Save failed')).toBeInTheDocument();
      });
    });
  });

  describe('Edge Cases', () => {
    it('handles missing localStorage secret gracefully', async () => {
      const user = userEvent.setup();
      mockLocalStorage.getItem.mockReturnValue(null);
      const mockFetch = vi.mocked(fetch);
      mockFetch.mockResolvedValueOnce({
        ok: true,
      } as Response);

      render(<SessionTitle {...defaultProps} />);

      await user.click(screen.getByText('Test Session Title'));
      const input = screen.getByRole('textbox');

      await user.clear(input);
      await user.type(input, 'No Secret Test');
      await user.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith('/api/sessions/test-session-123/title', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'x-secret-key': '',
          },
          body: JSON.stringify({ title: 'No Secret Test' }),
        });
      });
    });

    it('does not save when title is only whitespace', async () => {
      const user = userEvent.setup();
      render(<SessionTitle {...defaultProps} />);

      await user.click(screen.getByText('Test Session Title'));
      const input = screen.getByRole('textbox');

      await user.clear(input);
      await user.type(input, '   ');

      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

      // Enter key should not trigger save
      await user.keyboard('{Enter}');
      expect(screen.getByRole('textbox')).toBeInTheDocument(); // Still in edit mode
    });

    it('handles onTitleChange callback being undefined', async () => {
      const user = userEvent.setup();
      const mockFetch = vi.mocked(fetch);
      mockFetch.mockResolvedValueOnce({
        ok: true,
      } as Response);

      render(<SessionTitle {...defaultProps} onTitleChange={undefined} />);

      await user.click(screen.getByText('Test Session Title'));
      const input = screen.getByRole('textbox');

      await user.clear(input);
      await user.type(input, 'No Callback Test');
      await user.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith('/api/sessions/test-session-123/title', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'x-secret-key': 'test-secret',
          },
          body: JSON.stringify({ title: 'No Callback Test' }),
        });
        // Should not throw error and should exit edit mode
        expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
      });
    });
  });
});
