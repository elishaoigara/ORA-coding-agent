'use client';

import { useState, useEffect, useRef } from 'react';
import GitHubSidebar from '@/components/GitHubSidebar';
import ConversationList from '@/components/ConversationList';
import ChatInterface from '@/components/ChatInterface';
import { Message } from '@/types';

export default function Home() {
  const [conversations, setConversations] = useState<any[]>([]);
  const [currentConversation, setCurrentConversation] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  // Check if we're on mobile
  useEffect(() => {
    const checkIsMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    
    checkIsMobile();
    window.addEventListener('resize', checkIsMobile);
    
    return () => {
      window.removeEventListener('resize', checkIsMobile);
    };
  }, []);

  // Close mobile menu when resizing to desktop
  useEffect(() => {
    if (!isMobile) {
      setMobileMenuOpen(false);
    }
  }, [isMobile]);

  const handleNewConversation = () => {
    const newConversation = {
      id: Date.now().toString(),
      title: 'New Conversation',
      messages: [],
      createdAt: new Date(),
    };
    
    setConversations([newConversation, ...conversations]);
    setCurrentConversation(newConversation);
  };

  const handleSelectConversation = (conversation: any) => {
    setCurrentConversation(conversation);
    if (isMobile) {
      setMobileMenuOpen(false);
    }
  };

  const handleSendMessage = async (message: string) => {
    if (!currentConversation || isLoading) return;

    setIsLoading(true);
    
    // Add user message
    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: message,
      timestamp: new Date(),
    };

    const updatedMessages = [...currentConversation.messages, userMessage];
    const updatedConversation = {
      ...currentConversation,
      messages: updatedMessages,
    };

    // Update conversation list
    const updatedConversations = conversations.map(conv => 
      conv.id === currentConversation.id ? updatedConversation : conv
    );
    
    setConversations(updatedConversations);
    setCurrentConversation(updatedConversation);

    try {
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Add AI response
      const aiMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `This is a simulated response to: "${message}". In a real application, this would connect to an AI service.`,
        timestamp: new Date(),
      };

      const finalMessages = [...updatedMessages, aiMessage];
      const finalConversation = {
        ...updatedConversation,
        messages: finalMessages,
      };

      // Update conversation list
      const finalConversations = updatedConversations.map(conv => 
        conv.id === currentConversation.id ? finalConversation : conv
      );
      
      setConversations(finalConversations);
      setCurrentConversation(finalConversation);
    } catch (error) {
      console.error('Error sending message:', error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-gray-900 text-gray-100">
      {/* Mobile Header */}
      {isMobile && (
        <div className="md:hidden flex items-center justify-between p-4 border-b border-gray-700 bg-gray-800">
          <button 
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="p-2 rounded-md hover:bg-gray-700 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <h1 className="text-xl font-bold">AI Coding Agent</h1>
          <button 
            onClick={handleNewConversation}
            className="p-2 rounded-md hover:bg-gray-700 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
          </button>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar - Desktop */}
        {!isMobile && (
          <div className={`hidden md:flex flex-col w-64 border-r border-gray-700 bg-gray-800 transition-all duration-300`}>
            <div className="p-4 border-b border-gray-700">
              <button 
                onClick={handleNewConversation}
                className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 rounded-md transition-colors flex items-center justify-center"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
                New Chat
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <ConversationList 
                conversations={conversations} 
                onSelectConversation={handleSelectConversation}
                currentConversationId={currentConversation?.id}
              />
            </div>
            <div className="p-4 border-t border-gray-700">
              <GitHubSidebar />
            </div>
          </div>
        )}

        {/* Mobile Sidebar Overlay */}
        {isMobile && mobileMenuOpen && (
          <div className="fixed inset-0 z-50 md:hidden">
            <div className="absolute inset-0 bg-black bg-opacity-50" onClick={() => setMobileMenuOpen(false)}></div>
            <div className="absolute left-0 top-0 bottom-0 w-64 bg-gray-800 shadow-lg">
              <div className="p-4 border-b border-gray-700 flex justify-between items-center">
                <h2 className="text-lg font-semibold">Conversations</h2>
                <button 
                  onClick={() => setMobileMenuOpen(false)}
                  className="p-2 rounded-md hover:bg-gray-700 transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="flex-1 overflow-y-auto">
                <ConversationList 
                  conversations={conversations} 
                  onSelectConversation={handleSelectConversation}
                  currentConversationId={currentConversation?.id}
                />
              </div>
              <div className="p-4 border-t border-gray-700">
                <GitHubSidebar />
              </div>
            </div>
          </div>
        )}

        {/* Main Content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {currentConversation ? (
            <ChatInterface 
              conversation={currentConversation} 
              onSendMessage={handleSendMessage}
              isLoading={isLoading}
            />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-4 text-center">
              <div className="max-w-md">
                <h2 className="text-2xl font-bold mb-4">Welcome to AI Coding Agent</h2>
                <p className="text-gray-400 mb-6">
                  Start a new conversation to get started with AI-powered coding assistance.
                </p>
                <button 
                  onClick={handleNewConversation}
                  className="py-2 px-6 bg-blue-600 hover:bg-blue-700 rounded-md transition-colors"
                >
                  Start New Conversation
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}