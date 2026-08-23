// Environment Configuration for AutoPulse Chat
window.AutoPulseConfig = {
    // Environment detection
    isLocal: function() {
        return window.location.hostname === 'localhost' || 
               window.location.hostname === '127.0.0.1' || 
               window.location.hostname.includes('local');
    },
    
    // Get base URL based on environment
    getBaseUrl: function() {
        if (this.isLocal()) {
            return `${window.location.protocol}//${window.location.hostname}:8000/`;
        } else {
            return 'https://chat.autopulse.ai/';
        }
    },
    
    // Get API URL based on environment
    getApiUrl: function() {
        if (this.isLocal()) {
            return `${this.getBaseUrl()}api/vehicle`;
        } else {
            return 'https://chat.autopulse.ai/api/vehicle';
        }
    },
    
    // Get asset base URL
    getAssetUrl: function() {
        if (this.isLocal()) {
            return `${this.getBaseUrl()}assets/`;
        } else {
            return 'https://chat.autopulse.ai/assets/';
        }
    },
    
    // Environment info
    getEnvironment: function() {
        return this.isLocal() ? 'local' : 'production';
    }
};

// Set global variables for backward compatibility
window.baseurl = window.AutoPulseConfig.getBaseUrl();
window.apiurl = window.AutoPulseConfig.getApiUrl();

// Log configuration for debugging
console.log('AutoPulse Config:', {
    environment: window.AutoPulseConfig.getEnvironment(),
    baseUrl: window.baseurl,
    apiUrl: window.apiurl,
    assetUrl: window.AutoPulseConfig.getAssetUrl()
});
