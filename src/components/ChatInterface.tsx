'use client';

import { useState, useEffect, useRef } from 'react';
import ChatMessage from './ChatMessage';
import { Message } from '@/types';

interface ChatInterfaceProps {
  conversation: {
    id: string;
    title: string;
    messages: Message[];
    createdAt: Date;
  };
  onSendMessage: (message: string) => void;
  isLoading: boolean;
}

export default function ChatInterface({ conversation, onSendMessage, isLoading }: ChatInterfaceProps) {
  const [inputMessage, setInputMessage] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [conversation.messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputMessage.trim() && !isLoading) {
      onSendMessage(inputMessage.trim());
      setInputMessage('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-900">
      {/* Chat Header */}
      <div className="p-4 border-b border-gray-700 bg-gray-800 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">{conversation.title}</h2>
          <p className="text-sm text-gray-400">
            {conversation.messages.length} messages
          </p>
        </div>
        {isLoading && (
          <div className="flex items-center space-x-2">
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-500"></div>
            <span className="text-sm text-gray-400">AI is thinking...</span>
          </div>
        )}
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {conversation.messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="bg-gray-800 p-6 rounded-lg mb-4">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-blue-500 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
              <h3 className="text-lg font-medium text-gray-200">Start a Conversation</h3>
              <p className="text-gray-400 mt-2">
                Ask me anything or describe what you'd like to work on.
              </p>
            </div>
          </div>
        ) : (
          conversation.messages.map((message) => (
            <ChatMessage key={message.id} message={message} />
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="p-4 border-t border-gray-700 bg-gray-800">
        <form onSubmit={handleSubmit} className="flex space-x-2">
          <div className="flex-1 relative">
            <textarea
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type your message..."
              disabled={isLoading}
              className="w-full px-4 py-3 bg-gray-900 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-100 resize-none max-h-32 min-h-[44px]"
              rows={1}
              style={{ minHeight: '44px' }}
            />
            <div className="absolute bottom-2 right-2 text-xs text-gray-500">
              {inputMessage.length} chars
            </div>
          </div>
          <button
            type="submit"
            disabled={!inputMessage.trim() || isLoading}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg transition-colors flex items-center justify-center"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        </form>
        <div className="mt-2 text-center">
          <p className="text-xs text-gray-500">
            AI can make mistakes. Review important info.
          </p>
        </div>
      </div>
    </div>
  );
}