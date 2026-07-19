import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import PostCard from '@/components/PostCard'
import { Edit, Calendar, MapPin, MessageCircle, BadgeCheck } from 'lucide-react'
import Link from 'next/link'
import FollowButton from '@/components/FollowButton'

interface ProfilePageProps {
  params: Promise<{ id: string }>
}

export default async function ProfilePage({ params }: ProfilePageProps) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user: currentUser } } = await supabase.auth.getUser()
  if (!currentUser) redirect('/login')

  const { data: profile, error: profileError } = await supabase
    .from('profiles').select('*').eq('id', id).single()

  if (profileError || !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center space-y-4">
          <div className="text-6xl">🤷</div>
          <h1 className="text-2xl font-extrabold">Profile not found</h1>
          <Link href="/" className="btn-primary inline-flex items-center gap-2 text-sm">
            ← Back to Home
          </Link>
        </div>
      </div>
    )
  }

  const { data: posts } = await supabase
    .from('posts')
    .select(`
      *,
      profiles:user_id (id, username, avatar_url, country, city),
      circles:circle_id (id, name, slug),
      likes (user_id),
      comments (id),
      reactions (user_id, emoji),
      reposts (user_id),
      poll:polls (*)
    `)
    .eq('user_id', id)
    .order('created_at', { ascending: false })

  const { count: followersCount } = await supabase
    .from('follows').select('*', { count: 'exact', head: true }).eq('following_id', id)

  const { count: followingCount } = await supabase
    .from('follows').select('*', { count: 'exact', head: true }).eq('follower_id', id)

  const { data: followData } = await supabase
    .from('follows').select('follower_id')
    .eq('follower_id', currentUser.id).eq('following_id', id).single()

  const isFollowing = !!followData
  const isOwnProfile = currentUser.id === id

  return (
    <main className="max-w-xl mx-auto px-4 py-6 space-y-4">

      {/* ── Profile card ─────────────────────────────────── */}
      <div className="card p-5 space-y-4">

        {/* Top row: avatar + actions */}
        <div className="flex items-start justify-between gap-3">

          {/* Avatar */}
          <div className="avatar-ring shrink-0" style={{ borderRadius: '20px', padding: '2px' }}>
            <div
              className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl overflow-hidden flex items-center justify-center text-white font-black text-2xl"
              style={{ background: 'var(--grad-brand)' }}
            >
              {profile.avatar_url
                ? <img src={profile.avatar_url} className="w-full h-full object-cover" alt={profile.full_name} />
                : profile.username?.[0]?.toUpperCase() ?? '?'
              }
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex flex-col gap-2 shrink-0">
            {isOwnProfile ? (
              <>
                <Link
                  href="/profile/edit"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-semibold transition-all active:scale-95"
                  style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }}
                >
                  <Edit size={14} /> Edit
                </Link>
                {!profile.is_verified ? (
                  <Link
                    href="/profile/verify"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-semibold text-white transition-all active:scale-95"
                    style={{ background: 'var(--grad-brand)' }}
                  >
                    <BadgeCheck size={14} /> Verify
                  </Link>
                ) : (
                  <div
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-semibold"
                    style={{ background: 'rgba(168,85,247,0.1)', color: 'var(--nia-violet)' }}
                  >
                    <BadgeCheck size={14} /> Verified ✓
                  </div>
                )}
              </>
            ) : (
              <>
                <Link
                  href={`/messages/${id}`}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-semibold transition-all active:scale-95"
                  style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }}
                >
                  <MessageCircle size={14} /> Message
                </Link>
                <FollowButton
                  currentUserId={currentUser.id}
                  targetUserId={id}
                  initialIsFollowing={isFollowing}
                />
              </>
            )}
          </div>
        </div>

        {/* Name + username + location */}
        <div className="space-y-0.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            <h1 className="font-extrabold text-xl leading-tight" style={{ color: 'var(--text-primary)' }}>
              {profile.full_name}
            </h1>
            {profile.is_verified && (
              <BadgeCheck size={18} style={{ color: 'var(--nia-violet)' }} fill="rgba(168,85,247,0.2)" />
            )}
          </div>
          <p className="text-sm font-semibold" style={{ color: 'var(--nia-violet)' }}>
            @{profile.username}
          </p>
          {(profile.country || profile.city) && (
            <div className="flex items-center gap-1 text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
              <MapPin size={11} />
              <span>{profile.city ? `${profile.city}, ${profile.country}` : profile.country}</span>
            </div>
          )}
        </div>

        {/* Stats row */}
        <div
          className="grid grid-cols-3 gap-2 pt-3"
          style={{ borderTop: '1px solid var(--border)' }}
        >
          {[
            { label: 'Posts',     value: posts?.length ?? 0   },
            { label: 'Followers', value: followersCount ?? 0  },
            { label: 'Following', value: followingCount ?? 0  },
          ].map(({ label, value }) => (
            <div key={label} className="text-center">
              <p className="font-extrabold text-lg leading-tight" style={{ color: 'var(--text-primary)' }}>
                {value}
              </p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>{label}</p>
            </div>
          ))}
        </div>

        {/* Bio */}
        {profile.bio && (
          <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            {profile.bio}
          </p>
        )}

        {/* Join date */}
        <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-tertiary)' }}>
          <Calendar size={12} />
          <span>
            Joined{' '}
            {new Date(profile.created_at || Date.now()).toLocaleDateString('en-US', {
              month: 'long', year: 'numeric',
            })}
          </span>
        </div>
      </div>

      {/* ── Posts ─────────────────────────────────────────── */}
      <div className="space-y-3">
        <h2 className="font-bold px-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
          Posts
          <span className="ml-1 font-normal" style={{ color: 'var(--text-tertiary)' }}>
            ({posts?.length ?? 0})
          </span>
        </h2>

        {posts && posts.length === 0 && (
          <div className="card p-12 text-center space-y-2">
            <div className="text-4xl">📭</div>
            <p className="font-bold" style={{ color: 'var(--text-tertiary)' }}>No posts yet</p>
          </div>
        )}

        {posts?.map(post => (
          <PostCard key={post.id} post={post} currentUserId={currentUser.id} />
        ))}
      </div>
    </main>
  )
}