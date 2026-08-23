<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use App\Models\ChatSetting;

class ChatSettingStoreHoursSeeder extends Seeder
{
    /**
     * Run the database seeds.
     */
    public function run(): void
    {
        // Example of how to update existing ChatSetting records with store information
        $chatSettings = ChatSetting::all();

        foreach ($chatSettings as $setting) {
            $setting->update([
                // Store Address Information
                'store_address' => '123 Main Street',
                'store_city' => 'Springfield',
                'store_state' => 'IL',
                'store_zip' => '62701',
                'store_country' => 'USA',
                
                // Contact Person Information
                'contact_person_name' => 'John Smith',
                'contact_person_phone' => '+1 (555) 123-4567',
                'contact_person_email' => 'john.smith@dealership.com',
                
                // Timezone Configuration
                'timezone' => 'America/Chicago',
                
                // Store Hours (JSON format)
                'store_hours' => [
                    'monday' => ['open' => '08:00', 'close' => '20:00', 'closed' => false],
                    'tuesday' => ['open' => '08:00', 'close' => '20:00', 'closed' => false],
                    'wednesday' => ['open' => '08:00', 'close' => '20:00', 'closed' => false],
                    'thursday' => ['open' => '08:00', 'close' => '20:00', 'closed' => false],
                    'friday' => ['open' => '08:00', 'close' => '20:00', 'closed' => false],
                    'saturday' => ['open' => '09:00', 'close' => '18:00', 'closed' => false],
                    'sunday' => ['open' => '12:00', 'close' => '17:00', 'closed' => false]
                ],
                
                // Store Settings
                'is_store_hours_enabled' => true,
                'closed_message' => 'We are currently closed. Please leave a message and we\'ll get back to you during business hours.'
            ]);
        }
    }
}