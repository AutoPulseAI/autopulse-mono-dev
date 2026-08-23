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
        Schema::connection('secondary_db')->table('conversations', function (Blueprint $table) {
            // Add an auto-increment primary key. Existing rows will be assigned IDs automatically.
            $table->bigIncrements('id')->first();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::connection('secondary_db')->table('conversations', function (Blueprint $table) {
            // Drop the auto-increment column. Some databases require removing the primary key constraint first.
            $table->dropColumn('id');
        });
    }
};


