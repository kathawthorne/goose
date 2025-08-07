import React, { useState, useEffect, useRef } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Edit } from './icons';

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
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync with prop changes
  useEffect(() => {
    if (!isEditing) {
      setTitle(initialTitle);
      setEditValue(initialTitle);
    }
  }, [initialTitle, isEditing]);

  // Focus input when entering edit mode
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  // Basic validation
  const isValid = editValue.trim().length > 0 && editValue.length <= 100;

  const handleSave = async () => {
    if (!isValid) return;

    setIsSaving(true);
    setError(null);

    try {
      const response = await fetch(`/api/sessions/${sessionId}/title`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-secret-key': localStorage.getItem('secret') || '',
        },
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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
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
        <Input
          ref={inputRef}
          type="text"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={handleKeyDown}
          className={`
            flex-1 text-xl font-light
            ${isValid ? 'border-border-strong' : 'border-destructive'}
          `}
          placeholder="Enter session title..."
          maxLength={100}
          disabled={isSaving}
        />
        <Button onClick={handleSave} disabled={!isValid || isSaving} variant="default" size="sm">
          {isSaving ? 'Saving...' : 'Save'}
        </Button>
        <Button onClick={handleCancel} disabled={isSaving} variant="outline" size="sm">
          Cancel
        </Button>
        {error && <span className="text-destructive text-sm">{error}</span>}
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-2 group ${className}`}>
      <span
        className={`
          text-xl font-light cursor-pointer hover:text-text-accent transition-colors
          ${title === 'New Chat' ? 'text-textPlaceholder italic' : 'text-textStandard'}
        `}
        onClick={startEditing}
        title="Click to edit"
      >
        {title}
      </span>
      <Button
        onClick={startEditing}
        variant="ghost"
        size="xs"
        shape="round"
        className="opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <Edit className="w-3 h-3" />
      </Button>
    </div>
  );
}
