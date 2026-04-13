import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { API_URL } from '../utils/webrtc';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from './ui/dialog';
import { Textarea } from './ui/textarea';
import { Button } from './ui/button';

export default function NotesModal({ deviceId, deviceName, open, onClose }) {
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [updatedAt, setUpdatedAt] = useState(null);

  useEffect(() => {
    if (open && deviceId) {
      fetchNote();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, deviceId]);

  const calculateTimeAgo = (isoTimestamp) => {
    if (!isoTimestamp) return null;
    
    try {
      const updatedDate = new Date(isoTimestamp);
      const now = new Date();
      const diffMs = now - updatedDate;
      const diffSeconds = Math.floor(diffMs / 1000);
      const diffMinutes = Math.floor(diffSeconds / 60);
      const diffHours = Math.floor(diffMinutes / 60);
      const diffDays = Math.floor(diffHours / 24);
      
      if (diffDays > 0) {
        return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
      } else if (diffHours > 0) {
        return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
      } else if (diffMinutes > 0) {
        return `${diffMinutes} minute${diffMinutes !== 1 ? 's' : ''} ago`;
      } else {
        return 'Just now';
      }
    } catch (err) {
      console.error('Failed to calculate time ago:', err);
      return null;
    }
  };

  const fetchNote = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API_URL}/device-note/${deviceId}`);
      setNote(res.data.note || '');
      setUpdatedAt(res.data.updated_at);
    } catch (err) {
      if (err.response?.status === 404) {
        // No note exists yet - start with empty
        setNote('');
        setUpdatedAt(null);
      } else {
        console.error('Failed to fetch note:', err);
        setNote('');
        setUpdatedAt(null);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await axios.post(`${API_URL}/device-note`, {
        device_id: deviceId,
        note: note,
      });
      setUpdatedAt(res.data.updated_at);
      toast.success('Note saved successfully');
      onClose();
    } catch (err) {
      console.error('Failed to save note:', err);
      toast.error('Failed to save note. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            <div className="flex items-center justify-between">
              <span>Notes: {deviceName}</span>
              {updatedAt && (
                <span className="text-xs font-normal text-zinc-400">
                  Updated {calculateTimeAgo(updatedAt)}
                </span>
              )}
            </div>
          </DialogTitle>
        </DialogHeader>
        
        {loading ? (
          <div className="py-8 text-center text-sm text-zinc-400">
            Loading note...
          </div>
        ) : (
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Add notes about this device..."
            rows={8}
            className="resize-none"
          />
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={handleCancel}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={loading || saving}
          >
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
