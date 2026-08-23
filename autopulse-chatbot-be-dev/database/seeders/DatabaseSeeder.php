<?php

namespace Database\Seeders;

use App\Models\User;
// use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

class DatabaseSeeder extends Seeder
{
    /**
     * Seed the application's database.
     */
    public function run(): void
    {
        // User::factory(10)->create();

       /* User::factory()->create([
            'name' =>'Akash',
           
            'email' => 'test@gmail.com',
            'password' => Hash::make('!Q@W3e4r'),
        ]);*/

        $this->call([
            AdminSeeder::class,
            RolesAndPermissionsSeeder::class,
        ]);

        
     
    }
}
