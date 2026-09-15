import { useCallback, useEffect, useMemo, useState } from 'react'
import emptyImage from './assets/chat-empty.svg'
import heroImage from './assets/chat-hero.svg'

const API_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000'

const starterPrompts = [
  'Explain this project architecture',
  'Draft a study plan for React',
  'Summarize my last conversation',
]

const topicShortcuts = [
  {
    title: 'Coding help',
    prompt: 'Help me debug my code and explain the fix clearly.',
  },
  {
    title: 'Study planner',
    prompt: 'Create a simple study plan for the topic I give you.',
  },
  {
    title: 'Writing',
    prompt: 'Improve this writing and make it clear and professional.',
  },
  {
    title: 'Ideas',
    prompt: 'Give me creative ideas and practical next steps.',
  },
  {
    title: 'Summaries',
    prompt: 'Summarize this content into important points.',
  },
]

const inputClass =
  'min-h-12 w-full rounded-lg border border-slate-200 bg-white px-3.5 text-slate-900 outline-none transition focus:border-teal-700 focus:ring-4 focus:ring-teal-700/15'

const primaryButtonClass =
  'min-h-12 rounded-lg bg-teal-700 px-5 font-extrabold text-white transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-55'

function App() {
  const [token, setToken] = useState(() => localStorage.getItem('chatbot_token') || '')
  const [user, setUser] = useState(() => {
    const savedUser = localStorage.getItem('chatbot_user')
    return savedUser ? JSON.parse(savedUser) : null
  })
  const [authMode, setAuthMode] = useState('login')
  const [authForm, setAuthForm] = useState({ name: '', email: '', password: '' })
  const [conversations, setConversations] = useState([])
  const [activeConversationId, setActiveConversationId] = useState(null)
  const [messages, setMessages] = useState([])
  const [draft, setDraft] = useState('')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [isSending, setIsSending] = useState(false)

  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === activeConversationId),
    [activeConversationId, conversations],
  )

  const request = useCallback(async (path, options = {}) => {
    const response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    })

    const data = await response.json().catch(() => ({}))

    if (!response.ok) {
      throw new Error(data.detail || data.message || 'Something went wrong')
    }

    return data
  }, [token])

  function saveSession(nextToken, nextUser) {
    localStorage.setItem('chatbot_token', nextToken)
    localStorage.setItem('chatbot_user', JSON.stringify(nextUser))
    setToken(nextToken)
    setUser(nextUser)
  }

  function clearSession() {
    localStorage.removeItem('chatbot_token')
    localStorage.removeItem('chatbot_user')
    setToken('')
    setUser(null)
    setConversations([])
    setMessages([])
    setActiveConversationId(null)
    setDraft('')
  }

  const loadMessages = useCallback(async (conversationId) => {
    if (!conversationId) {
      setMessages([])
      return
    }

    const data = await request(`/api/conversations/${conversationId}/messages`)
    setMessages(data)
  }, [request])

  const loadConversations = useCallback(async (userId) => {
    if (!token || !userId) return

    const data = await request(`/api/users/${userId}/conversations`)
    setConversations(data)
  }, [request, token])

  async function handleAuth(event) {
    event.preventDefault()
    setError('')
    setStatus('')

    try {
      if (authMode === 'register') {
        await request('/api/register', {
          method: 'POST',
          body: JSON.stringify(authForm),
        })
        setStatus('Account created. Sign in to continue.')
        setAuthMode('login')
        return
      }

      const data = await request('/api/login', {
        method: 'POST',
        body: JSON.stringify({
          email: authForm.email,
          password: authForm.password,
        }),
      })

      if (!data.access_token) {
        throw new Error(data.message || 'Invalid email or password')
      }

      saveSession(data.access_token, {
        id: data.user_id,
        name: data.name,
        email: authForm.email,
      })
      setStatus('Signed in.')
    } catch (authError) {
      setError(authError.message)
    }
  }

  function startFreshChat() {
    setActiveConversationId(null)
    setMessages([])
    setDraft('')
    setError('')
  }

  function chooseTopic(topic) {
    startFreshChat()
    setDraft(topic.prompt)
  }

  async function deleteConversation(event, conversationId) {
    event.stopPropagation()
    setError('')

    try {
      await request(`/api/conversations/${conversationId}`, {
        method: 'DELETE',
      })

      setConversations((current) => current.filter((conversation) => conversation.id !== conversationId))

      if (conversationId === activeConversationId) {
        startFreshChat()
      }
    } catch (deleteError) {
      setError(deleteError.message)
    }
  }

  async function sendMessage(event) {
    event?.preventDefault()

    const message = draft.trim()
    if (!message || isSending) return

    setError('')
    setIsSending(true)

    let conversationId = activeConversationId
    let createdConversationId = null
    const previousMessages = messages

    try {
      if (!conversationId) {
        const title = message.length > 42 ? `${message.slice(0, 42)}...` : message
        const data = await request('/api/conversations', {
          method: 'POST',
          body: JSON.stringify({ title }),
        })
        conversationId = data.conversation_id
        setConversations((current) => [
          { id: data.conversation_id, title: data.title || title },
          ...current,
        ])
        createdConversationId = conversationId
      }

      setMessages((current) => [...current, { role: 'user', content: message }])
      setDraft('')

      const data = await request('/api/chat', {
        method: 'POST',
        body: JSON.stringify({
          conversation_id: conversationId,
          message,
        }),
      })

      setMessages((current) => [...current, { role: 'assistant', content: data.reply }])

      if (createdConversationId) {
        setActiveConversationId(createdConversationId)
      }
    } catch (chatError) {
      setMessages(previousMessages)
      setError(chatError.message)
    } finally {
      setIsSending(false)
    }
  }

  useEffect(() => {
    if (!token) return

    loadMessages(activeConversationId).catch((loadError) => {
      setError(loadError.message)
    })
  }, [activeConversationId, loadMessages, token])

  useEffect(() => {
    if (!token || !user?.id) return

    loadConversations(user.id).catch((loadError) => {
      setError(loadError.message)
    })
  }, [loadConversations, token, user?.id])

  if (!token || !user) {
    return (
      <main className="grid min-h-screen bg-slate-50 text-slate-950 lg:grid-cols-[minmax(0,1.1fr)_minmax(360px,480px)]">
        <section className="relative flex min-h-[42vh] items-end overflow-hidden bg-[#13222b] p-6 text-white sm:p-10 lg:min-h-screen lg:p-14">
          <img className="absolute inset-0 h-full w-full object-cover" src={heroImage} alt="" />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(19,34,43,0.2),rgba(19,34,43,0.9)),linear-gradient(90deg,rgba(19,34,43,0.86),rgba(19,34,43,0.2))]" />
          <div className="relative z-10 max-w-2xl">
            <p className="text-xs font-black uppercase text-teal-200">AI Chatbot</p>
            <h1 className="mt-2 max-w-3xl text-[40px] font-extrabold leading-[0.95] tracking-normal sm:text-6xl lg:text-7xl">
              Your focused workspace for smarter conversations.
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-8 text-white/80">
              Sign in and start focused chats with clean topic shortcuts, saved
              messages, and a smooth workspace.
            </p>
          </div>
        </section>

        <section className="flex flex-col justify-center gap-7 border-l border-slate-200 bg-white p-6 sm:p-10 lg:p-12">
          <div className="flex items-center gap-3 font-extrabold text-slate-950">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-700 text-sm font-black text-white">
              AI
            </span>
            <span>AI Chatbot</span>
          </div>

          <div className="grid grid-cols-2 rounded-lg border border-slate-200 bg-slate-50 p-1">
            <button
              className={`min-h-10 rounded-md font-bold transition ${
                authMode === 'login'
                  ? 'bg-white text-slate-950 shadow-lg shadow-slate-900/10'
                  : 'text-slate-500'
              }`}
              onClick={() => setAuthMode('login')}
              type="button"
            >
              Sign in
            </button>
            <button
              className={`min-h-10 rounded-md font-bold transition ${
                authMode === 'register'
                  ? 'bg-white text-slate-950 shadow-lg shadow-slate-900/10'
                  : 'text-slate-500'
              }`}
              onClick={() => setAuthMode('register')}
              type="button"
            >
              Create account
            </button>
          </div>

          <form className="grid gap-4" onSubmit={handleAuth}>
            {authMode === 'register' && (
              <label className="grid gap-2 text-sm font-bold text-slate-600">
                Name
                <input
                  className={inputClass}
                  value={authForm.name}
                  onChange={(event) => setAuthForm({ ...authForm, name: event.target.value })}
                  placeholder="Rishabh"
                  required
                />
              </label>
            )}
            <label className="grid gap-2 text-sm font-bold text-slate-600">
              Email
              <input
                className={inputClass}
                value={authForm.email}
                onChange={(event) => setAuthForm({ ...authForm, email: event.target.value })}
                placeholder="you@example.com"
                required
                type="email"
              />
            </label>
            <label className="grid gap-2 text-sm font-bold text-slate-600">
              Password
              <input
                className={inputClass}
                value={authForm.password}
                onChange={(event) => setAuthForm({ ...authForm, password: event.target.value })}
                placeholder="Enter your password"
                required
                type="password"
              />
            </label>

            {error && <p className="m-0 font-bold text-red-700">{error}</p>}
            {status && <p className="m-0 font-bold text-teal-700">{status}</p>}

            <button className={primaryButtonClass} type="submit">
              {authMode === 'login' ? 'Sign in' : 'Create account'}
            </button>
          </form>
        </section>
      </main>
    )
  }

  return (
    <main className="grid min-h-screen bg-[radial-gradient(circle_at_80%_10%,rgba(20,184,166,0.16),transparent_34%),linear-gradient(135deg,#f7fbfc_0%,#edf4f7_100%)] text-slate-950 lg:grid-cols-[320px_minmax(0,1fr)]">
      <aside className="flex min-h-fit flex-col gap-5 border-b border-white/10 bg-[linear-gradient(180deg,rgba(16,37,43,0.98),rgba(9,24,29,0.98))] p-5 text-white shadow-2xl shadow-slate-900/15 lg:min-h-screen lg:border-b-0 lg:border-r">
        <div className="flex items-center gap-3 font-extrabold">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-200 text-sm font-black text-[#103033]">
            AI
          </span>
          <span>AI Chatbot</span>
        </div>

        <button
          className="min-h-12 rounded-lg bg-teal-200 px-5 font-extrabold text-[#0b2a2f] shadow-xl shadow-teal-300/15 transition hover:bg-teal-300"
          onClick={startFreshChat}
          type="button"
        >
          + Fresh chat
        </button>

        <div className="grid gap-2 overflow-y-auto lg:content-start">
          <p className="mb-0.5 mt-1 text-xs font-black uppercase text-white/60">Topics</p>
          {topicShortcuts.map((topic) => (
            <button
              className="grid min-h-20 gap-1.5 rounded-lg border border-white/10 bg-white/6 p-3.5 text-left text-white transition hover:-translate-y-0.5 hover:border-teal-200/60 hover:bg-teal-200/12"
              key={topic.title}
              onClick={() => chooseTopic(topic)}
              type="button"
            >
              <span className="font-extrabold">{topic.title}</span>
              <small className="line-clamp-2 text-xs leading-5 text-white/65">{topic.prompt}</small>
            </button>
          ))}
        </div>

        <div className="grid gap-2 overflow-y-auto border-t border-white/10 pt-4 lg:max-h-72 lg:content-start">
          <p className="mb-0.5 text-xs font-black uppercase text-white/60">History</p>
          {conversations.length ? (
            conversations.map((conversation) => (
              <div
                className={`grid min-h-11 grid-cols-[minmax(0,1fr)_34px] items-center gap-2 rounded-lg border py-1.5 pl-3 pr-1.5 text-sm font-bold transition ${
                  conversation.id === activeConversationId
                    ? 'border-teal-200/70 bg-teal-200/18 text-white'
                    : 'border-white/10 bg-white/5 text-white/75 hover:border-white/20 hover:bg-white/10 hover:text-white'
                }`}
                key={conversation.id}
              >
                <button
                  className="min-w-0 truncate text-left"
                  onClick={() => setActiveConversationId(conversation.id)}
                  type="button"
                >
                  {conversation.title || 'Untitled chat'}
                </button>
                <button
                  aria-label="Delete chat"
                  className="flex h-8 w-8 items-center justify-center rounded-md text-white/55 transition hover:bg-red-500/20 hover:text-red-200"
                  onClick={(event) => deleteConversation(event, conversation.id)}
                  type="button"
                >
                  <svg
                    aria-hidden="true"
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                  >
                    <path d="M3 6h18" />
                    <path d="M8 6V4h8v2" />
                    <path d="M19 6l-1 14H6L5 6" />
                    <path d="M10 11v5" />
                    <path d="M14 11v5" />
                  </svg>
                </button>
              </div>
            ))
          ) : (
            <p className="m-0 rounded-lg border border-dashed border-white/10 px-3 py-3 text-sm text-white/45">
              No chats yet
            </p>
          )}
        </div>

        <div className="mt-auto grid gap-3 border-t border-white/10 pt-4">
          <div className="grid gap-1">
            <strong>{user.name}</strong>
            <span className="truncate text-xs text-white/65">{user.email}</span>
          </div>
          <button
            className="w-fit border-0 bg-transparent font-extrabold text-teal-200"
            onClick={clearSession}
            type="button"
          >
            Sign out
          </button>
        </div>
      </aside>

      <section className="grid min-w-0 grid-rows-[auto_1fr_auto_auto] lg:h-screen">
        <header className="border-b border-slate-200 bg-white/80 px-5 py-6 backdrop-blur-xl sm:px-9">
          <p className="m-0 text-xs font-black uppercase text-teal-700">Conversation</p>
          <h1 className="mt-1 text-3xl font-semibold leading-tight text-slate-950">
            {activeConversation?.title || 'Ask AI anything'}
          </h1>
        </header>

        <div className="min-h-[58vh] overflow-y-auto px-5 py-8 sm:px-9 lg:min-h-0">
          {!messages.length && (
            <section className="mx-auto grid max-w-3xl justify-items-center px-2 py-8 text-center">
              <img
                className="mb-6 aspect-[1.4] w-[min(340px,78vw)] rounded-lg object-cover shadow-2xl shadow-teal-800/15"
                src={emptyImage}
                alt=""
              />
              <h2 className="m-0 text-4xl font-semibold leading-tight text-slate-950">
                Start with a clear question.
              </h2>
              <p className="m-0 mt-3 max-w-xl leading-7 text-slate-500">
                Choose a prompt or type your own. Your conversation is saved once you send.
              </p>
              <div className="mt-7 grid w-full max-w-3xl gap-2.5 sm:grid-cols-3">
                {starterPrompts.map((prompt) => (
                  <button
                    className="min-h-20 rounded-lg border border-slate-200 bg-white/85 p-4 text-left font-bold text-slate-800 shadow-xl shadow-slate-900/5 transition hover:border-teal-300 hover:bg-teal-50"
                    key={prompt}
                    onClick={() => setDraft(prompt)}
                    type="button"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </section>
          )}

          {messages.map((message, index) => {
            const isUser = message.role === 'user'

            return (
              <article
                className={`mx-auto mb-4 grid w-full max-w-4xl gap-3 ${
                  isUser
                    ? 'grid-cols-[minmax(0,1fr)_44px] sm:grid-cols-[minmax(0,760px)_44px]'
                    : 'grid-cols-[44px_minmax(0,1fr)] sm:grid-cols-[44px_minmax(0,760px)]'
                }`}
                key={`${message.role}-${index}`}
              >
                <div
                  className={`flex h-11 w-11 items-center justify-center rounded-lg text-xs font-black text-white ${
                    isUser ? 'col-start-2 row-start-1 bg-slate-800' : 'bg-teal-700'
                  }`}
                >
                  {isUser ? 'You' : 'AI'}
                </div>
                <p
                  className={`m-0 min-w-0 whitespace-pre-wrap break-words rounded-lg border p-4 leading-7 ${
                    isUser
                      ? 'col-start-1 row-start-1 justify-self-end border-teal-700 bg-teal-700 text-white'
                      : 'border-slate-200 bg-white/90 text-slate-800'
                  }`}
                >
                  {message.content}
                </p>
              </article>
            )
          })}

          {isSending && (
            <article className="mx-auto mb-4 grid w-full max-w-4xl grid-cols-[44px_minmax(0,760px)] gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-teal-700 text-xs font-black text-white">
                AI
              </div>
              <p className="m-0 rounded-lg border border-slate-200 bg-white/90 p-4 leading-7 text-slate-800">
                Thinking...
              </p>
            </article>
          )}
        </div>

        {error && (
          <p className="mx-5 mb-3 rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 font-bold text-red-700 sm:mx-9">
            {error}
          </p>
        )}

        <form
          className="grid gap-3 border-t border-slate-200 bg-white/85 px-5 py-5 backdrop-blur-xl sm:px-9 lg:grid-cols-[minmax(0,1fr)_104px]"
          onSubmit={sendMessage}
        >
          <textarea
            className="max-h-36 min-h-13 w-full resize-y rounded-lg border border-slate-200 bg-white px-4 py-3.5 leading-6 text-slate-950 outline-none transition focus:border-teal-700 focus:ring-4 focus:ring-teal-700/15"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                sendMessage(event)
              }
            }}
            placeholder="Ask anything..."
            rows="1"
          />
          <button className={primaryButtonClass} disabled={!draft.trim() || isSending} type="submit">
            Send
          </button>
        </form>
      </section>
    </main>
  )
}

export default App
