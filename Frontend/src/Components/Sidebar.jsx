import React from 'react'
import { NavLink } from 'react-router-dom' 

import { AudioLines } from 'lucide-react'


import SidebarButton from './MiniComponents/SidebarButton'
const Sidebar = () => {
  return (
    <div className='h-screen w-70 bg-blue-950 flex-col'>

      <div className='w-full h-20 p-5'>

        <div className='flex gap-2 justify-center items-center'>
            <AudioLines size={28} className='text-white hover:text-black' />
            <h5 className='flex text-white text-2xl font-bold text-center hover:text-black'>  Lumina <p className='text-blue-600 hover:text-black'>STFU</p></h5>
        </div>
      </div>


      <div className='pt-30 flex-col'>
        <SidebarButton text="Dashboard" link="/admin-dashboard"/>
        <SidebarButton text="Log" link="/admin-log" />
        <SidebarButton text="Admin Settings" link="/admin-settings"/>
      </div>

      
    </div>
  )
}

export default Sidebar
