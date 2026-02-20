import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Image, MapPin, Smile, Hash, Camera, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useNavigate } from 'react-router';
import { Actions } from '@/services/actions';

export function CreatePost() {
  const [activeTab, setActiveTab] = useState<'text' | 'media'>('text');
  const [text, setText] = useState('');
  const [media, setMedia] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const handlePost = async () => {
    if (!text.trim()) return;
    setPublishing(true);
    setError(null);
    const result = await Actions.publishNote(text);
    setPublishing(false);
    if (result.success) {
      navigate('/');
    } else {
      setError(result.error || 'Failed to publish');
    }
  };

  const handleMediaUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setMedia(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-black text-white relative">
      <div className="flex items-center justify-between p-4 border-b border-zinc-800">
        <button onClick={() => navigate(-1)} className="text-zinc-400 hover:text-white">
          <X size={24} />
        </button>
        <div className="flex bg-zinc-900 rounded-full p-1">
          <TabButton 
            active={activeTab === 'text'} 
            onClick={() => setActiveTab('text')} 
            label="Post" 
          />
          <TabButton 
            active={activeTab === 'media'} 
            onClick={() => setActiveTab('media')} 
            label="Story" 
          />
        </div>
        <button
          onClick={handlePost}
          disabled={(!text && !media) || publishing}
          className="font-bold text-blue-500 disabled:opacity-50 hover:text-blue-400 transition-colors flex items-center gap-1"
        >
          {publishing ? <Loader2 size={16} className="animate-spin" /> : null}
          {publishing ? 'Posting...' : 'Share'}
        </button>
      </div>

      {error && (
        <div className="mx-4 mt-2 p-2 bg-red-900/30 border border-red-800 rounded-lg text-red-300 text-sm">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4">
        <div className="flex gap-3">
          <div className="w-10 h-10 rounded-full overflow-hidden bg-zinc-800 flex-shrink-0">
            <div className="w-full h-full bg-purple-600 flex items-center justify-center text-white text-sm font-bold">N</div>
          </div>
          
          <div className="flex-1">
            <textarea
              placeholder={activeTab === 'text' ? "What's happening?" : "Add a caption..."}
              className="w-full bg-transparent text-lg placeholder:text-zinc-600 focus:outline-none resize-none min-h-[150px]"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />

            <AnimatePresence>
              {activeTab === 'media' && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mt-4"
                >
                  <label className="block w-full aspect-square bg-zinc-900 rounded-xl border-2 border-dashed border-zinc-800 hover:border-zinc-600 transition-colors cursor-pointer relative overflow-hidden group">
                    {media ? (
                      <>
                        <img src={media} alt="Upload preview" className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                          <span className="text-white font-medium">Change Image</span>
                        </div>
                      </>
                    ) : (
                      <div className="flex flex-col items-center justify-center h-full text-zinc-500">
                        <Camera size={48} className="mb-2" />
                        <span className="text-sm font-medium">Tap to add photo</span>
                      </div>
                    )}
                    <input type="file" accept="image/*" className="hidden" onChange={handleMediaUpload} />
                  </label>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      <div className="p-4 border-t border-zinc-800">
        <div className="flex items-center gap-4 text-blue-500">
          <button className="p-2 hover:bg-blue-500/10 rounded-full transition-colors">
            <Image size={24} />
          </button>
          <button className="p-2 hover:bg-blue-500/10 rounded-full transition-colors">
            <Hash size={24} />
          </button>
          <button className="p-2 hover:bg-blue-500/10 rounded-full transition-colors">
            <Smile size={24} />
          </button>
          <button className="p-2 hover:bg-blue-500/10 rounded-full transition-colors ml-auto text-zinc-500 hover:text-blue-500">
            <MapPin size={24} />
          </button>
        </div>
      </div>
    </div>
  );
}

function TabButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "px-6 py-1.5 rounded-full text-sm font-medium transition-all relative z-0",
        active ? "text-black" : "text-zinc-400 hover:text-white"
      )}
    >
      {active && (
        <motion.div
          layoutId="activeTab"
          className="absolute inset-0 bg-white rounded-full -z-10"
          transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
        />
      )}
      {label}
    </button>
  );
}
