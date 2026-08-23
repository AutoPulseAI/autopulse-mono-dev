<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('chatbot_settings', function (Blueprint $table) {
            // Store Address Information
            $table->text('store_address')->nullable()->after('position');
            $table->string('store_city')->nullable()->after('store_address');
            $table->string('store_state')->nullable()->after('store_city');
            $table->string('store_zip')->nullable()->after('store_state');
            $table->string('store_country')->default('USA')->after('store_zip');
            
            // Contact Person Information
            $table->string('contact_person_name')->nullable()->after('store_country');
            $table->string('contact_person_phone')->nullable()->after('contact_person_name');
            $table->string('contact_person_email')->nullable()->after('contact_person_phone');
            
            // Timezone Configuration
            $table->string('timezone')->default('America/New_York')->after('contact_person_email');
            
            // Daily Store Hours (JSON format)
            // Will store: {"monday": {"open": "09:00", "close": "18:00", "closed": false}, ...}
            $table->json('store_hours')->nullable()->after('timezone');
            
            // General Store Settings
            $table->boolean('is_store_hours_enabled')->default(true)->after('store_hours');
            $table->text('closed_message')->nullable()->after('is_store_hours_enabled');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('chatbot_settings', function (Blueprint $table) {
            $table->dropColumn([
                'store_address',
                'store_city', 
                'store_state',
                'store_zip',
                'store_country',
                'contact_person_name',
                'contact_person_phone',
                'contact_person_email',
                'timezone',
                'store_hours',
                'is_store_hours_enabled',
                'closed_message'
            ]);
        });
    }
};
