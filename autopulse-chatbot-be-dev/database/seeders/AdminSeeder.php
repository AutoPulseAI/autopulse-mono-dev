<?php

namespace Database\Seeders;

use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use App\Models\Admin;
use App\Models\Dealer;
use Spatie\Permission\Models\Role;

use Spatie\Permission\Models\Permission;

class AdminSeeder extends Seeder
{
    /**
     * Run the database seeds.
     */
    public function run(): void
    {
        
     
        $admin2 = Admin::create([
                'name' =>'Admin',
            
                'email' => 'admin@autopulse.com',
                'password' => Hash::make('!Q@W3e4r'),
            ],
        );


    }
}
