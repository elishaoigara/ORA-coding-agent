'use client';

import { useState } from 'react';
import { Conversation } from '@/types';

export default function ConversationList({ 
  conversations, 
  onSelectConversation,
  currentConversationId
}: { 
  conversations: Conversation[]; 
  onSelectConversation: (conversation: Conversation) => void;
  currentConversationId?: string;
}) {
  const [expandedConversation, setExpandedConversation] = useState<string | null>(null);

  const toggleConversation = (id: string) => {
    setExpandedConversation(expandedConversation === id ? null : id);
  };

  return (
    <div className="p-2 space-y-1">
      {conversations.length === 0 ? (
        <div className="p-4 text-center text-gray-400">
          No conversations yet
        </div>
      ) : (
        conversations.map((conversation) => (
          <div 
            key={conversation.id} 
            className={`rounded-md cursor-pointer transition-colors ${
              currentConversationId === conversation.id 
                ? 'bg-blue-600 text-white' 
                : 'hover:bg-gray-700'
            }`}
          >
            <div 
              className="p-3 flex items-center justify-between"
              onClick={() => onSelectConversation(conversation)}
            >
              <div className="flex-1 min-w-0">
                <div className="truncate font-medium">{conversation.title}</div>
                <div className="text-xs opacity-75">
                  {new Date(conversation.createdAt).toLocaleDateString()}
                </div>
              </div>
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  toggleConversation(conversation.id);
                }}
                className="p-1 rounded-md hover:bg-gray-600 transition-colors ml-2"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className={`h-4 w-4 transition-transform ${expandedConversation === conversation.id ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </div>
            
            {expandedConversation === conversation.id && (
              <div className="px-3 pb-3 pt-1 border-t border-gray-700 text-sm">
                <div className="text-gray-300 mb-1">Messages:</div>
                <div className="space-y-1">
                  {conversation.messages.slice(0, 3).map((message, index) => (
                    <div key={index} className="truncate text-gray-400">
                      {message.role}: {message.content.substring(0, 50)}...
                    </div>
                  ))}
                  {conversation.messages.length > 3 && (
                    <div className="text-gray-500 text-xs">
                      +{conversation.messages.length - 3} more messages
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}