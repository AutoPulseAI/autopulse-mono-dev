<?php
namespace App\Providers;

use OpenSearch\ClientBuilder;
use Illuminate\Support\ServiceProvider;

class OpenSearchServiceProvider extends ServiceProvider
{
    public function register()
    {
        $this->app->singleton('opensearch', function () {
            return (new ClientBuilder())
                ->setHosts([env('OPENSEARCH_HOST')])
                ->setSigV4Region(env('AWS_REGION')) // e.g., us-east-2
                ->setSigV4Service('es')
                ->setSigV4CredentialProvider([
                    'key' => env('AWS_ACCESS_KEY_ID'),
                    'secret' => env('AWS_SECRET_ACCESS_KEY'),
                ])
                ->build();
        });
    }

    public function boot()
    {
        //
    }
}
