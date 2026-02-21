import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { Hash, TrendingUp, Heart, MessageSquare, RefreshCw } from 'lucide-react';
import { useTrendingStore } from '@/stores/trendingStore';
import { useProfileStore } from '@/stores/profileStore';
import { Profiles } from '@/services/profiles';
import { truncateNpub, timeAgo, pubkeyColor } from '@/utils/helpers';
import type { TrendingPost } from '@/types/nostr';

const MAX_TAG_LEN = 20;
const MAX_NAME_LEN = 16;
const MAX_CONTENT_LEN = 80;

export function TrendingSidebar() {
  const navigate = useNavigate();
  const { hashtags, posts, loading, lastUpdated, initialize, refresh } = useTrendingStore();
  useProfileStore((s) => s.updateTick);

  useEffect(() => {
    initialize();
  }, []);

  const handleHashtagClick = (tag: string) => {
    navigate(`/explore?q=%23${encodeURIComponent(tag)}`);
  };

  const lastUpdatedLabel = lastUpdated
    ? timeAgo(Math.floor(lastUpdated / 1000))
    : '';

  return (
    <div className="space-y-4 overflow-hidden">
      {/* Trending Hashtags */}
      <div className="bg-zinc-900 rounded-xl p-3">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-sm flex items-center gap-1.5">
            <TrendingUp size={14} className="text-purple-400" />
            Trending
          </h3>
          {!loading && (
            <button
              onClick={() => refresh()}
              className="text-zinc-500 hover:text-zinc-300 transition-colors"
              title="Refresh trending"
            >
              <RefreshCw size={12} />
            </button>
          )}
        </div>

        {loading && hashtags.length === 0 ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-2 animate-pulse">
                <div className="w-4 h-4 rounded bg-zinc-800" />
                <div className="flex-1">
                  <div className="h-3 bg-zinc-800 rounded w-20" />
                </div>
              </div>
            ))}
          </div>
        ) : hashtags.length === 0 ? (
          <p className="text-zinc-500 text-xs">No trending hashtags yet</p>
        ) : (
          <div className="space-y-0.5">
            {hashtags.slice(0, 5).map((item) => (
              <button
                key={item.tag}
                onClick={() => handleHashtagClick(item.tag)}
                className="flex items-center gap-2 w-full px-2 py-1.5 rounded-lg hover:bg-zinc-800 transition-colors text-left group"
              >
                <Hash size={12} className="text-purple-400 flex-shrink-0" />
                <span className="text-xs font-medium text-zinc-200 group-hover:text-white truncate max-w-[120px]">
                  {item.tag.length > MAX_TAG_LEN ? item.tag.slice(0, MAX_TAG_LEN) + '...' : item.tag}
                </span>
                <span className="text-[10px] text-zinc-500 flex-shrink-0 ml-auto">
                  {item.count}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Popular Posts */}
      <div className="bg-zinc-900 rounded-xl p-3">
        <h3 className="font-bold text-sm mb-3 flex items-center gap-1.5">
          <Heart size={14} className="text-pink-400" />
          Popular
        </h3>

        {loading && posts.length === 0 ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="animate-pulse">
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-4 h-4 rounded-full bg-zinc-800" />
                  <div className="h-2.5 bg-zinc-800 rounded w-16" />
                </div>
                <div className="h-2.5 bg-zinc-800 rounded w-full mt-1" />
              </div>
            ))}
          </div>
        ) : posts.length === 0 ? (
          <p className="text-zinc-500 text-xs">No popular posts yet</p>
        ) : (
          <div className="space-y-2">
            {posts.slice(0, 5).map((post) => (
              <TrendingPostCard key={post.id} post={post} />
            ))}
          </div>
        )}
      </div>

      {/* Last updated footer */}
      {lastUpdatedLabel && (
        <p className="text-[10px] text-zinc-600 text-center">
          Updated {lastUpdatedLabel}
        </p>
      )}
    </div>
  );
}

function TrendingPostCard({ post }: { post: TrendingPost }) {
  useProfileStore((s) => s.updateTick);
  const profile = Profiles.get(post.pubkey);
  const rawName = profile?.displayName || profile?.name || truncateNpub(post.pubkey);
  const displayName = rawName.length > MAX_NAME_LEN ? rawName.slice(0, MAX_NAME_LEN) + '...' : rawName;
  const avatarUrl = profile?.picture || '';
  const fallbackColor = pubkeyColor(post.pubkey);

  // Strip URLs and cap content length
  const cleanContent = post.content.replace(/https?:\/\/\S+/g, '').trim();
  const preview = cleanContent.length > MAX_CONTENT_LEN
    ? cleanContent.slice(0, MAX_CONTENT_LEN) + '...'
    : cleanContent;

  return (
    <div className="px-2 py-1.5 rounded-lg hover:bg-zinc-800 transition-colors group cursor-pointer">
      {/* Author row */}
      <div className="flex items-center gap-1.5 mb-0.5">
        <div
          className="w-4 h-4 rounded-full overflow-hidden bg-zinc-700 flex-shrink-0 flex items-center justify-center"
          style={!avatarUrl ? { backgroundColor: fallbackColor } : undefined}
        >
          {avatarUrl ? (
            <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="text-white text-[6px] font-bold">
              {rawName.slice(0, 2).toUpperCase()}
            </span>
          )}
        </div>
        <span className="text-[11px] text-zinc-400 truncate">{displayName}</span>
        <span className="text-[10px] text-zinc-600 flex-shrink-0">· {timeAgo(post.created_at)}</span>
      </div>

      {/* Content preview */}
      {preview && (
        <p className="text-xs text-zinc-300 leading-snug group-hover:text-zinc-100 line-clamp-2">
          {preview}
        </p>
      )}

      {/* Interaction counts */}
      <div className="flex items-center gap-2.5 mt-1 text-[10px] text-zinc-500">
        <span className="flex items-center gap-0.5">
          <Heart size={10} className="text-pink-500/70" />
          {post.reactionCount}
        </span>
        <span className="flex items-center gap-0.5">
          <MessageSquare size={10} className="text-blue-500/70" />
          {post.replyCount}
        </span>
      </div>
    </div>
  );
}
