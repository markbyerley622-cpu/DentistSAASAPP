import { useState } from 'react'
import { Outlet, NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import {
  LayoutDashboard,
  Phone,
  Users,
  Settings,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Menu,
  X,
  Sparkles
} from 'lucide-react'

const navigation = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Missed Calls', href: '/calls', icon: Phone },
  { name: 'Follow-ups', href: '/leads', icon: Users },
  { name: 'Settings', href: '/settings', icon: Settings },
]

function Sidebar({ collapsed, setCollapsed, mobileOpen, setMobileOpen }) {
  const { user, logout } = useAuth()
  const location = useLocation()

  const sidebarContent = (
    <>
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 py-6 border-b border-dark-800/50">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-accent-500 to-purple-600 flex items-center justify-center shadow-lg shadow-accent-500/20">
          <Sparkles className="w-5 h-5 text-white" />
        </div>
        {!collapsed && (
          <div className="animate-fade-in">
            <h1 className="font-semibold text-dark-100">SmileDesk</h1>
            <p className="text-xs text-dark-500">Never miss a call again</p>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {navigation.map((item) => {
          const isActive = location.pathname === item.href
          return (
            <NavLink
              key={item.name}
              to={item.href}
              onClick={() => setMobileOpen(false)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 group ${
                isActive
                  ? 'bg-accent-600/10 text-accent-400 shadow-inner-glow'
                  : 'text-dark-400 hover:text-dark-100 hover:bg-dark-800/50'
              }`}
            >
              <item.icon className={`w-5 h-5 flex-shrink-0 transition-colors ${
                isActive ? 'text-accent-400' : 'text-dark-500 group-hover:text-dark-300'
              }`} />
              {!collapsed && (
                <span className="font-medium animate-fade-in">{item.name}</span>
              )}
              {isActive && !collapsed && (
                <div className="ml-auto w-1.5 h-1.5 rounded-full bg-accent-400 animate-pulse-slow" />
              )}
            </NavLink>
          )
        })}
      </nav>

      {/* User section */}
      <div className="border-t border-dark-800/50 p-3">
        <div className={`flex items-center gap-3 px-3 py-2 rounded-lg ${collapsed ? 'justify-center' : ''}`}>
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-dark-700 to-dark-800 flex items-center justify-center text-sm font-medium text-dark-300 border border-dark-700">
            {user?.practiceName?.charAt(0)?.toUpperCase() || 'D'}
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0 animate-fade-in">
              <p className="text-sm font-medium text-dark-200 truncate">
                {user?.practiceName || 'Practice'}
              </p>
              <p className="text-xs text-dark-500 truncate">{user?.email}</p>
            </div>
          )}
        </div>
        <button
          onClick={logout}
          className={`w-full mt-2 flex items-center gap-3 px-3 py-2.5 rounded-lg text-dark-400 hover:text-danger-400 hover:bg-danger-500/10 transition-all duration-200 ${
            collapsed ? 'justify-center' : ''
          }`}
        >
          <LogOut className="w-5 h-5" />
          {!collapsed && <span className="font-medium animate-fade-in">Logout</span>}
        </button>
      </div>

      {/* Collapse button - desktop only */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="hidden lg:flex absolute -right-3 top-20 w-6 h-6 rounded-full bg-dark-800 border border-dark-700 items-center justify-center text-dark-400 hover:text-dark-200 hover:bg-dark-700 transition-all shadow-lg"
      >
        {collapsed ? (
          <ChevronRight className="w-4 h-4" />
        ) : (
          <ChevronLeft className="w-4 h-4" />
        )}
      </button>
    </>
  )

  return (
    <>
      {/* Mobile sidebar backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-dark-950/80 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile sidebar */}
      <aside
        className={`fixed top-0 left-0 z-50 h-full w-64 bg-dark-900/95 backdrop-blur-xl border-r border-dark-800/50 transform transition-transform duration-300 ease-out lg:hidden ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <button
          onClick={() => setMobileOpen(false)}
          className="absolute top-4 right-4 p-2 rounded-lg text-dark-400 hover:text-dark-100 hover:bg-dark-800"
        >
          <X className="w-5 h-5" />
        </button>
        <div className="flex flex-col h-full">
          {sidebarContent}
        </div>
      </aside>

      {/* Desktop sidebar */}
      <aside
        className={`hidden lg:flex fixed top-0 left-0 z-30 h-full flex-col bg-dark-900/50 backdrop-blur-xl border-r border-dark-800/50 transition-all duration-300 ${
          collapsed ? 'w-20' : 'w-64'
        }`}
      >
        {sidebarContent}
      </aside>
    </>
  )
}

function Header({ setMobileOpen }) {
  const { user } = useAuth()
  const location = useLocation()

  // Get current page title
  const currentPage = navigation.find(item => item.href === location.pathname)
  const pageTitle = currentPage?.name || 'Dashboard'

  return (
    <header className="sticky top-0 z-20 h-16 bg-dark-950/80 backdrop-blur-xl border-b border-dark-800/50">
      <div className="flex items-center justify-between h-full px-4 lg:px-8">
        {/* Mobile menu button */}
        <button
          onClick={() => setMobileOpen(true)}
          className="lg:hidden p-2 rounded-lg text-dark-400 hover:text-dark-100 hover:bg-dark-800"
        >
          <Menu className="w-5 h-5" />
        </button>

        {/* Page title */}
        <div className="hidden lg:block">
          <h1 className="text-lg font-semibold text-dark-100">{pageTitle}</h1>
        </div>

        {/* Mobile logo */}
        <div className="lg:hidden flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent-500 to-purple-600 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <span className="font-semibold text-dark-100">SmileDesk</span>
        </div>

        {/* Right side */}
        <div className="flex items-center gap-4">
          {/* Status indicator */}
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-success-500/10 border border-success-500/20">
            <div className="w-2 h-2 rounded-full bg-success-500 animate-pulse" />
            <span className="text-xs font-medium text-success-400">AI Active</span>
          </div>

          {/* User avatar - desktop */}
          <div className="hidden lg:flex items-center gap-3 pl-4 border-l border-dark-800">
            <div>
              <p className="text-sm font-medium text-dark-200 text-right">
                {user?.practiceName}
              </p>
              <p className="text-xs text-dark-500 text-right">{user?.email}</p>
            </div>
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-dark-700 to-dark-800 flex items-center justify-center text-sm font-medium text-dark-300 border border-dark-700">
              {user?.practiceName?.charAt(0)?.toUpperCase() || 'D'}
            </div>
          </div>
        </div>
      </div>
    </header>
  )
}

export default function Layout() {
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <div className="min-h-screen bg-dark-950">
      <Sidebar
        collapsed={collapsed}
        setCollapsed={setCollapsed}
        mobileOpen={mobileOpen}
        setMobileOpen={setMobileOpen}
      />

      <div className={`transition-all duration-300 ${collapsed ? 'lg:pl-20' : 'lg:pl-64'}`}>
        <Header setMobileOpen={setMobileOpen} />

        <main className="p-4 lg:p-8">
          <div className="animate-fade-in">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
