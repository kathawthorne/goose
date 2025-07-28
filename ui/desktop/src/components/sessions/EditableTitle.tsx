import React, { useState, useRef, useEffect } from 'react';
import { Edit, Check, X, LoaderCircle } from 'lucide-react';
import { Button } from '../ui/button';

interface EditableTitleProps {
  title: string;
  onSave: (newTitle: string) => Promise<void>;
  className?: string;
  placeholder?: string;
  maxLength?: number;
  disabled?: boolean;
  isAutoGenerating?: boolean; // Add prop for auto-generation state
}

export const EditableTitle: React.FC<EditableTitleProps> = ({
  title,
  onSave,
  className = '',
  placeholder = 'Enter title...',
  maxLength = 100,
  disabled = false,
  isAutoGenerating = false,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(title);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Update editValue when title prop changes
  useEffect(() => {
    if (!isEditing) {
      setEditValue(title);
    }
  }, [title, isEditing]);

  // Focus input when entering edit mode
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleStartEdit = () => {
    if (disabled) return;
    setIsEditing(true);
    setError(null);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setEditValue(title);
    setError(null);
  };

  const handleSave = async () => {
    const trimmedValue = editValue.trim();
    
    // Don't save if value hasn't changed
    if (trimmedValue === title) {
      setIsEditing(false);
      return;
    }

    // Validate input
    if (!trimmedValue) {
      setError('Title cannot be empty');
      return;
    }

    if (trimmedValue.length > maxLength) {
      setError(`Title must be ${maxLength} characters or less`);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      await onSave(trimmedValue);
      setIsEditing(false);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to save title';
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleCancel();
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEditValue(e.target.value);
    if (error) {
      setError(null);
    }
  };

  if (isEditing) {
    return (
      <div className={`flex flex-col ${className}`}>
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={editValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            maxLength={maxLength}
            disabled={isLoading}
            className="flex-1 text-4xl font-light bg-transparent border-b-2 border-borderSubtle focus:border-textProminent outline-none px-0 py-1 disabled:opacity-50"
          />
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={handleSave}
              disabled={isLoading || !editValue.trim()}
              className="h-8 w-8 p-0"
            >
              {isLoading ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4 text-green-600" />
              )}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleCancel}
              disabled={isLoading}
              className="h-8 w-8 p-0"
            >
              <X className="h-4 w-4 text-red-600" />
            </Button>
          </div>
        </div>
        {error && (
          <div className="text-red-500 text-sm mt-1 px-0">
            {error}
          </div>
        )}
        <div className="text-xs text-textSubtle mt-1 px-0">
          Press Enter to save, Escape to cancel
        </div>
      </div>
    );
  }

  return (
    <div className={`group flex items-center gap-2 ${className}`}>
      <div className="flex items-center gap-2 flex-1">
        <h1 className={`text-4xl font-light ${!title ? 'text-textSubtle' : ''}`}>
          {title || placeholder}
        </h1>
        {isAutoGenerating && (
          <div className="flex items-center gap-2">
            <LoaderCircle className="h-4 w-4 animate-spin text-textSubtle" />
            <span className="text-sm text-textSubtle">Generating title...</span>
          </div>
        )}
      </div>
      {!disabled && !isAutoGenerating && (
        <Button
          size="sm"
          variant="ghost"
          onClick={handleStartEdit}
          className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <Edit className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
};
