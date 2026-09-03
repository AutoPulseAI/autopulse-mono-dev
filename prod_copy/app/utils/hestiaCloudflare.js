import { exec } from "child_process";
import JSON5 from 'json5'; // Import the json5 library
//  HestiaCP API - Add Web Domain
//  HestiaCP API - Add Mail Domain
export const addHestiaDomain = async (domain) => {
    try {
      const HESTIA_CP_API_URL = process.env.HESTIA_CP_API_URL;
      const HESTIA_CP_API_KEY = process.env.HESTIA_CP_API_KEY;
      const HESTIA_CP_USER = process.env.HESTIA_CP_USER;
  
      if (!HESTIA_CP_API_URL || !HESTIA_CP_API_KEY || !HESTIA_CP_USER) {
        throw new Error("HestiaCP API credentials are missing from environment variables.");
      }
  
      const endpoint = `${HESTIA_CP_API_URL}/api/`;
      const payload = new URLSearchParams({
        hash: HESTIA_CP_API_KEY,
        user: HESTIA_CP_USER,
        cmd: "v-add-mail-domain",
        arg1: HESTIA_CP_USER,
        arg2: domain,
        //arg3 : 'json'
        
      });
  
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: payload,
      });
  
      // Get the raw response text
      const rawResponse = await response.text();
  
      // Check if the response is "OK" (plain text success response)
      if (rawResponse === "OK") {
        return { success: true, message: "Mail domain added successfully" };
      }
  
      // Check if domain already exists
      if (rawResponse.includes("exists") || rawResponse.includes("already exists")) {
        console.log(`Mail domain ${domain} already exists, proceeding with DNS setup`);
        return { success: true, message: "Mail domain already exists, proceeding with DNS setup" };
      }
  
      // If the response is not "OK", try to parse it as JSON
      try {
        const result = JSON.parse(rawResponse);
  
        // Check if the JSON response indicates success
        if (result && result.success) {
          return { success: true, message: "Mail domain added successfully" };
        } else {
          throw new Error(`Failed to add mail domain: ${result.error || "Unknown error"}`);
        }
      } catch (jsonError) {
        // If parsing as JSON fails, log the raw response and throw an error
        console.error("Non-JSON response from HestiaCP API:", rawResponse);
        throw new Error(`Unexpected response format: ${rawResponse}`);
      }
    } catch (error) {
      console.error("Error in HestiaCP domain setup:", error);
      throw new Error("HestiaCP mail domain setup failed");
    }
  };

// Check if mail domain exists in HestiaCP
export const checkHestiaDomainExists = async (domain) => {
    try {
      const HESTIA_CP_API_URL = process.env.HESTIA_CP_API_URL;
      const HESTIA_CP_API_KEY = process.env.HESTIA_CP_API_KEY;
      const HESTIA_CP_USER = process.env.HESTIA_CP_USER;
  
      if (!HESTIA_CP_API_URL || !HESTIA_CP_API_KEY || !HESTIA_CP_USER) {
        throw new Error("HestiaCP API credentials are missing from environment variables.");
      }
  
      const endpoint = `${HESTIA_CP_API_URL}/api/`;
      const payload = new URLSearchParams({
        hash: HESTIA_CP_API_KEY,
        user: HESTIA_CP_USER,
        cmd: "v-list-mail-domain",
        arg1: HESTIA_CP_USER,
        arg2: domain,
        arg3: "json"
      });
  
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: payload,
      });
  
      const rawResponse = await response.text();
      
      // If response contains the domain, it exists
      if (rawResponse.includes(domain)) {
        return { exists: true, message: "Domain exists" };
      }
      
      return { exists: false, message: "Domain does not exist" };
    } catch (error) {
      console.error("Error checking HestiaCP domain existence:", error);
      return { exists: false, message: "Error checking domain existence" };
    }
  };

//  Cloudflare API - Add DNS Records
export const getHestiaDNSRecords = async (domain) => {
    try {
        const HESTIA_CP_API_URL = process.env.HESTIA_CP_API_URL;
        const HESTIA_CP_API_KEY = process.env.HESTIA_CP_API_KEY;
        const HESTIA_CP_USER = process.env.HESTIA_CP_USER;
    
        if (!HESTIA_CP_API_URL || !HESTIA_CP_API_KEY || !HESTIA_CP_USER) {
            throw new Error("HestiaCP API credentials are missing from environment variables.");
        }
  
      // Fetch DKIM public key
        const dkimEndpoint = `${HESTIA_CP_API_URL}/api/`;
        const dkimPayload = new URLSearchParams({
            hash: HESTIA_CP_API_KEY,
            user: HESTIA_CP_USER,
            cmd: "v-list-mail-domain-dkim",
            arg1: HESTIA_CP_USER,
            arg2: domain,
            arg3: "json",
        });
    
        const dkimResponse = await fetch(dkimEndpoint, {
            method: "POST",
            headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            },
            body: dkimPayload,
        });
  
        // Get the response as JSON
        let dkimResponseText = await dkimResponse.text();
       
        // Use json5 to parse the response (it can handle unescaped newlines)
        let dkimResult;
        try {
            dkimResult = JSON5.parse(dkimResponseText);
        } catch (jsonError) {
            console.error("Invalid JSON received from HestiaCP:", dkimResponseText);
            // Check if the error is because domain doesn't exist
            if (dkimResponseText.includes("doesn't exist") || dkimResponseText.includes("not found")) {
                throw new Error(`Mail domain ${domain} doesn't exist in HestiaCP`);
            }
            throw new Error("Failed to parse JSON from HestiaCP.");
        }

        
        // Ensure DKIM public key is present
        if (!dkimResult[domain] || !dkimResult[domain].PUB) {
            throw new Error(`DKIM public key not found for domain ${domain}. Domain may not exist or DKIM not configured.`);
        }

        // Extract and clean DKIM public key (remove newlines)
        const dkimPublicKey = dkimResult[domain].PUB.replace(/\n/g, "").trim();

       
        // Extract and clean DKIM public key (remove newlines)
       
        // Define DNS records based on HestiaCP data
        // Configuration variables
        const config = {
          serverIp: process.env.BASEIP,
          domain: domain, // Assuming domain is defined elsewhere
          dkimPublicKey: dkimPublicKey, // Assuming this is defined
          dmarcPolicy: "quarantine",
          dmarcPercentage: 100,
          defaultTtl: 14400,
          dkimTtl: 3600
        };

        const dnsRecords = [
          // A Records
          { 
            type: "A", 
            name: `mail.${config.domain}`, 
            content: config.serverIp, 
            ttl: config.defaultTtl 
          },
          { 
            type: "A", 
            name: `webmail.${config.domain}`, 
            content: config.serverIp, 
            ttl: config.defaultTtl 
          },

          // MX Record
          { 
            type: "MX", 
            name: config.domain, 
            content: `mail.${config.domain}`, 
            priority: 10, 
            ttl: config.defaultTtl 
          },

          // TXT Records
          { 
            type: "TXT", 
            name: config.domain, 
            content: `v=spf1 a mx ip4:${config.serverIp} -all`, 
            ttl: config.defaultTtl 
          },
          { 
            type: "TXT", 
            name: `_dmarc.${config.domain}`, 
            content: `v=DMARC1; p=${config.dmarcPolicy}; pct=${config.dmarcPercentage}`,
            ttl: config.defaultTtl 
          },
          { 
            type: "TXT", 
            name: `mail._domainkey.${config.domain}`, 
            content: `v=DKIM1; k=rsa; p=${config.dkimPublicKey}`, 
            ttl: config.dkimTtl 
          },
          { 
            type: "TXT", 
            name: `_domainkey.${config.domain}`, 
            content: "t=y; o=-", 
            ttl: config.dkimTtl 
          }
        ];
    
        return dnsRecords;
    } catch (error) {
        console.error("Error retrieving DNS records from HestiaCP:", error);
        throw new Error("Failed to retrieve DNS records from HestiaCP");
    }
};

export const addHestiaEmailAccount = async (email, password,domain) => {
    const HESTIA_CP_API_URL = process.env.HESTIA_CP_API_URL;
    const HESTIA_CP_API_KEY = process.env.HESTIA_CP_API_KEY;
    const HESTIA_CP_USER = process.env.HESTIA_CP_USER;

    const payload = new URLSearchParams({
        hash: HESTIA_CP_API_KEY,
        user: HESTIA_CP_USER,
        cmd: "v-add-mail-account",
        arg1: HESTIA_CP_USER, // HestiaCP username
        arg2: domain, // Domain name
        arg3: email.split("@")[0], // Email username (e.g., rahul from rahul@ravi.com)
        arg4: password, // Email password
        arg5: "0", // Quota in MB (0 for unlimited)
        arg6: "", // Optional arguments
    });
    const response = await fetch(`${HESTIA_CP_API_URL}/api/`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: payload,
    });

    const rawResponse = await response.text();
    if (rawResponse === "OK") {
        return { success: true };
    } else {
        return { success: false, error: rawResponse };
    }
};
  
export const addCloudflareDNS = async (domain, dnsRecords) => {
    try {
      const CLOUDFLARE_API_KEY = process.env.CLOUDFLARE_API_TOKEN;
      const CLOUDFLARE_ZONE_ID = process.env.CLOUDFLARE_ZONE_ID;
  
      if (!CLOUDFLARE_API_KEY || !CLOUDFLARE_ZONE_ID) {
        throw new Error("Cloudflare credentials are missing from environment variables.");
      }
      
      // Add DNS records to Cloudflare
      for (const record of dnsRecords) {
        console.log(dnsRecords);
        console.log(CLOUDFLARE_API_KEY);
        console.log(CLOUDFLARE_ZONE_ID)
        const response = await fetch(
          `https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/dns_records`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${CLOUDFLARE_API_KEY}`,
            },
            body: JSON.stringify({
              type: record.type,
              name: record.name,
              content: record.content,
              ttl: record.ttl,
              priority: record.priority || undefined, // Only for MX records
            }),
          }
        );
  
        const result = await response.json();
        if (!result.success) {
          
          throw new Error(`Failed to add ${record.type} record: ${JSON.stringify(result.errors)}`);
        }
  
        //console.log(`${record.type} record added for ${record.name}`);
      }
  
      return "Cloudflare DNS records added successfully";
    } catch (error) {
      console.error(error);
      throw new Error("Cloudflare DNS setup failed");
    }
};
