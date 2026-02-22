import React, {useState} from 'react'
import { Outlet } from 'react-router-dom'

import Sidebar from './Sidebar'

function Layout() {
    const [isExpanded, setIsExpanded] = useState(true);
    const toggleSidebar = () => setIsExpanded(!isExpanded);

  return (
    <div className='flex flex-row w-full min-h-screen'>
        <Sidebar />

        <div className='flex-1'>
            <Outlet />
        </div>
        

    </div>
  )
}

export default Layout
