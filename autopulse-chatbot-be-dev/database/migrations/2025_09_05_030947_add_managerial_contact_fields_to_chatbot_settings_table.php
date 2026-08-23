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
            // Managerial Contact Information
            $table->string('managerial_contact_phone')->nullable()->after('contact_person_email');
            $table->string('managerial_contact_email')->nullable()->after('managerial_contact_phone');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('chatbot_settings', function (Blueprint $table) {
            $table->dropColumn([
                'managerial_contact_phone',
                'managerial_contact_email'
            ]);
        });
    }
};
