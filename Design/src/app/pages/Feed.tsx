import React, { useState } from 'react';
import { motion } from 'motion/react';
import { MessageSquare, Repeat2, Heart, Share, MoreHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Link } from 'react-router';

// Types
type PostType = 'tweet' | 'insta';

interface Post {
  id: string;
  type: PostType;
  user: {
    name: string;
    handle: string;
    avatar: string;
  };
  content?: string;
  media?: string[];
  likes: number;
  comments: number;
  shares: number;
  timestamp: string;
}

const MOCK_POSTS: Post[] = [
  {
    id: '1',
    type: 'tweet',
    user: {
      name: 'Sarah Connor',
      handle: '@sarahc',
      avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100&h=100&fit=crop',
    },
    content: "Just launched my new React Native project! 🚀 It's amazing how fast you can iterate with Fast Refresh. #reactnative #devlife",
    likes: 124,
    comments: 12,
    shares: 45,
    timestamp: '2h',
  },
  {
    id: '2',
    type: 'insta',
    user: {
      name: 'Photography Daily',
      handle: '@photodaily',
      avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=100&h=100&fit=crop',
    },
    media: ['https://images.unsplash.com/photo-1682687220742-aba13b6e50ba?w=800&h=800&fit=crop'],
    content: "Golden hour in the mountains. 🏔️✨ The light hit just right. #nature #photography #goldenhour",
    likes: 2453,
    comments: 102,
    shares: 89,
    timestamp: '5h',
  },
  {
    id: '3',
    type: 'tweet',
    user: {
      name: 'Alex Rivera',
      handle: '@arivera',
      avatar: 'https://images.unsplash.com/photo-1599566150163-29194dcaad36?w=100&h=100&fit=crop',
    },
    content: "Unpopular opinion: Tabs > Spaces. Don't @ me. 🤷‍♂️",
    likes: 56,
    comments: 234,
    shares: 12,
    timestamp: '6h',
  },
  {
    id: '4',
    type: 'insta',
    user: {
      name: 'Foodie Heaven',
      handle: '@foodie_h',
      avatar: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=100&h=100&fit=crop',
    },
    media: ['https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=800&h=800&fit=crop'],
    content: "Pizza night done right! 🍕🍅 Homemade dough is a game changer.",
    likes: 892,
    comments: 45,
    shares: 23,
    timestamp: '8h',
  },
];

export function Feed() {
  return (
    <div className="bg-black min-h-screen text-white pb-24 md:pb-0">
      <header className="sticky top-0 z-10 bg-black/80 backdrop-blur-md border-b border-zinc-800 p-4 flex justify-between items-center md:hidden">
        <h1 className="text-xl font-bold bg-gradient-to-r from-purple-500 to-pink-500 bg-clip-text text-transparent">SocialApp</h1>
        <div className="w-8 h-8 rounded-full bg-zinc-800 overflow-hidden">
          <img src="https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&h=100&fit=crop" alt="User" />
        </div>
      </header>

      <div className="max-w-xl mx-auto divide-y divide-zinc-800">
        {MOCK_POSTS.map((post) => (
          <PostCard key={post.id} post={post} />
        ))}
      </div>
    </div>
  );
}

function PostCard({ post }: { post: Post }) {
  if (post.type === 'tweet') {
    return <TweetPost post={post} />;
  }
  return <InstaPost post={post} />;
}

function TweetPost({ post }: { post: Post }) {
  const [liked, setLiked] = useState(false);

  return (
    <article className="p-4 hover:bg-zinc-900/30 transition-colors cursor-pointer border-b border-zinc-800">
      <div className="flex gap-3">
        <Link to={`/profile/${post.user.handle}`} className="flex-shrink-0">
          <div className="w-10 h-10 rounded-full overflow-hidden bg-zinc-800">
            <img src={post.user.avatar} alt={post.user.name} className="w-full h-full object-cover" />
          </div>
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <Link to={`/profile/${post.user.handle}`} className="font-bold hover:underline truncate text-white">{post.user.name}</Link>
            <span className="text-zinc-500 text-sm truncate">{post.user.handle}</span>
            <span className="text-zinc-500 text-sm">· {post.timestamp}</span>
          </div>
          
          <p className="mt-1 text-[15px] leading-relaxed text-zinc-100 whitespace-pre-wrap">{post.content}</p>

          <div className="mt-3 flex justify-between max-w-sm text-zinc-500">
            <ActionButton icon={MessageSquare} count={post.comments} color="blue" />
            <ActionButton icon={Repeat2} count={post.shares} color="green" />
            <ActionButton 
              icon={Heart} 
              count={liked ? post.likes + 1 : post.likes} 
              active={liked} 
              color="pink" 
              onClick={(e) => { e.preventDefault(); setLiked(!liked); }}
            />
            <ActionButton icon={Share} />
          </div>
        </div>
      </div>
    </article>
  );
}

function InstaPost({ post }: { post: Post }) {
  const [liked, setLiked] = useState(false);
  const [lastTap, setLastTap] = useState(0);

  const handleDoubleTap = (e: React.MouseEvent) => {
    const now = Date.now();
    if (now - lastTap < 300) {
      setLiked(true);
      // Could trigger a heart animation here
    }
    setLastTap(now);
  };

  return (
    <article className="pb-4 border-b border-zinc-800 bg-black">
      <div className="flex items-center justify-between p-3">
        <div className="flex items-center gap-2">
          <Link to={`/profile/${post.user.handle}`} className="w-8 h-8 rounded-full bg-gradient-to-tr from-yellow-400 to-purple-600 p-[2px]">
            <div className="bg-black p-[2px] w-full h-full rounded-full">
              <img src={post.user.avatar} className="w-full h-full rounded-full object-cover" alt="" />
            </div>
          </Link>
          <Link to={`/profile/${post.user.handle}`} className="font-semibold text-sm">{post.user.handle}</Link>
        </div>
        <button className="text-zinc-400">
          <MoreHorizontal size={20} />
        </button>
      </div>

      <div 
        className="aspect-square bg-zinc-900 relative overflow-hidden"
        onClick={handleDoubleTap}
      >
        {post.media && (
          <img src={post.media[0]} alt="Post content" className="w-full h-full object-cover" />
        )}
        {/* Heart animation overlay would go here */}
      </div>

      <div className="p-3">
        <div className="flex justify-between items-center mb-2">
          <div className="flex gap-4">
            <button onClick={() => setLiked(!liked)} className={cn("transition-colors", liked ? "text-red-500" : "text-white")}>
              <Heart size={26} fill={liked ? "currentColor" : "none"} strokeWidth={2} />
            </button>
            <button className="text-white hover:text-zinc-300">
              <MessageSquare size={26} strokeWidth={2} />
            </button>
            <button className="text-white hover:text-zinc-300">
              <Share size={26} strokeWidth={2} />
            </button>
          </div>
        </div>

        <div className="font-semibold text-sm mb-1">{liked ? post.likes + 1 : post.likes} likes</div>
        
        <div className="text-sm">
          <span className="font-semibold mr-2">{post.user.handle}</span>
          <span className="text-zinc-100">{post.content}</span>
        </div>
        
        <button className="text-zinc-500 text-sm mt-1">View all {post.comments} comments</button>
        <div className="text-zinc-600 text-xs mt-1 uppercase">{post.timestamp} ago</div>
      </div>
    </article>
  );
}

function ActionButton({ icon: Icon, count, active, color, onClick }: any) {
  const colorMap: any = {
    blue: 'hover:text-blue-500',
    green: 'hover:text-green-500',
    pink: 'hover:text-pink-500',
  };

  return (
    <button 
      className={cn(
        "flex items-center gap-1 group transition-colors p-2 -ml-2 rounded-full hover:bg-zinc-800",
        active ? (color === 'pink' ? 'text-pink-500' : 'text-blue-500') : "text-zinc-500",
        colorMap[color]
      )}
      onClick={onClick}
    >
      <div className="relative">
        <Icon size={18} fill={active ? "currentColor" : "none"} />
      </div>
      {count !== undefined && <span className="text-xs group-hover:font-medium">{count}</span>}
    </button>
  );
}
