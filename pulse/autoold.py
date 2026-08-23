from flask import Flask, request, jsonify
from flask_cors import CORS, cross_origin
import openai
import tiktoken
import spacy
import mysql.connector
from mysql.connector import Error
import uuid
import json
from pathlib import Path
from pprint import pprint
import bs4
from langchain import hub
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_community.document_loaders import WebBaseLoader
from langchain_community.vectorstores import Chroma
from langchain_core.output_parsers import StrOutputParser
from langchain_core.runnables import RunnablePassthrough
from langchain_openai import ChatOpenAI, OpenAIEmbeddings
import os
from langchain_core.documents import Document
from langchain.text_splitter import RecursiveCharacterTextSplitter
from datetime import datetime
from dotenv import load_dotenv
import requests
import logging
from logging.config import fileConfig
#To support Multilingual
from langdetect import detect, LangDetectException
from deep_translator import GoogleTranslator
import re

load_dotenv() 

app = Flask(__name__)
CORS(app, support_credentials=False)

#Commented for Dev testing
#logconfpath=os.getenv('LOG_CONF_PATH'),
# Set up logging
logging.basicConfig(
    filename='autopulse_chatbot.log',  # store in current folder
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)

#fileConfig(logconfpath)

# Load English language model
nlp = spacy.load("en_core_web_md")

os.environ["OPENAI_API_KEY"] = str(os.getenv('OPENAI_API_KEY'))
os.environ["CURL_CA_BUNDLE"] = ""

# Set up your OpenAI API key
openai.api_key = os.getenv('OPENAI_API_KEY') 
#file_path='./facet.json'

# ----------------- Safety helpers (redaction) -----------------
SENSITIVE_KEYS = {"password", "pass", "pwd", "token", "auth", "access_token", "api_key", "apikey", "authorization"}

def redact_dict(d: dict, keys_to_keep=()):
    """Shallow recursive redaction of obviously sensitive keys before logging."""
    if not isinstance(d, dict):
        return d
    out = {}
    for k, v in d.items():
        kl = k.lower()
        if kl in SENSITIVE_KEYS and k not in keys_to_keep:
            out[k] = "[REDACTED]"
        else:
            if isinstance(v, dict):
                out[k] = redact_dict(v, keys_to_keep)
            elif isinstance(v, list):
                out[k] = "[LIST]" if len(v) > 20 else [redact_dict(i, keys_to_keep) if isinstance(i, dict) else i for i in v]
            elif isinstance(v, str):
                out[k] = v if len(v) < 500 else v[:500] + "...[TRUNCATED]"
            else:
                out[k] = v
    return out

def redact_url(url: str) -> str:
    try:
        from urllib.parse import urlparse, parse_qsl, urlencode, urlunparse
        p = urlparse(url)
        qs = dict(parse_qsl(p.query, keep_blank_values=True))
        for k in list(qs.keys()):
            if k.lower() in SENSITIVE_KEYS:
                qs[k] = "[REDACTED]"
        netloc = p.netloc
        if "@" in netloc:
            creds, host = netloc.split("@", 1)
            if ":" in creds:
                user, _ = creds.split(":", 1)
                netloc = f"{user}:[REDACTED]@{host}"
            else:
                netloc = f"{creds}@{host}"
        new_q = urlencode(qs, doseq=True)
        return urlunparse((p.scheme, netloc, p.path, p.params, new_q, p.fragment))
    except Exception:
        return url

# ----------------- Auto-reply templates (used when escalate==true) -----------------
AUTO_REPLY_TEMPLATES = {
    "managerial_review_vehicle_history": (
        "Thanks — a specialist from [DEALER_NAME] will reach out shortly to help with the vehicle history report. "
        "Meanwhile you can view details here: [VEHICLE_URL]"
    ),
    "managerial_review_location_transfer": (
        "Thanks — someone from [DEALER_NAME] will contact you to discuss nearest locations or transfer options. "
        "We'll follow up by phone or email as you prefer."
    ),
    "managerial_review_finance": (
        "Thanks — our finance team will contact you to discuss financing and programs. If you prefer a callback, reply with 'callback' and a preferred time."
    ),
    "managerial_review_tradein": (
        "Thanks — a trade-in specialist will reach out to start an appraisal. Please share your car's make, model, year, and rough condition if you'd like a quicker estimate."
    ),
    "managerial_human_request": (
        "Understood — a manager will contact you shortly. If you want immediate help, reply 'CALL' and your preferred time."
    ),
    "opt_out_confirm": (
        "You have been unsubscribed from follow-ups. If this was a mistake, reply 'RESUME' and we'll reinstate contact."
    ),
    "generic_escalation": (
        "Thanks — a member of [DEALER_NAME] will review and get back to you shortly. We'll include your message and any requested vehicle details."
    )
}

# ----------------- Classifier prompt & helpers -----------------
CLASSIFIER_SYSTEM = (
    "You are a high-precision intent & sentiment classifier for an automobile dealership. "
    "Analyze the customer's message and prior context and return ONLY one compact JSON object "
    "on a SINGLE LINE with two keys: intent and sentiment. Maximize RECALL for escalation: whenever "
    "in doubt, classify as Managerial Review. Treat typos, slang, emojis, and multilingual variants as valid. "
    "DO NOT add any prose, markdown, or extra text—RETURN ONLY the single-line JSON."
)

CLASSIFIER_USER_TEMPLATE = (
    "Customer Message: {message}\nOld Conversation Context: {context}\n\n"
    "Intent choices (choose exactly one): Visit Requested | Visit Suggested | Visit Booked | Managerial Review\n"
    "Sentiment choices (choose exactly one): Positive | Neutral | Negative\n\n"
    "If ANY trigger in A–J applies (opt-out, vehicle history/Carfax, finance, warranty, trade-in, PII, negative risk, location/no-follow, operational risk, etc.), "
    "return intent=Managerial Review.\n\n"
    "Return output EXACTLY as: {\"intent\":\"<Visit Requested|Visit Suggested|Visit Booked|Managerial Review>\",\"sentiment\":\"<Positive|Neutral|Negative>\"}"
)

# Fast local prefilter: if matched -> immediate Managerial Review (keeps recall very high)
PREFILTER_PATTERNS = {
    "vehicle_history": re.compile(r"\b(carfax|autocheck|vehicle history|title|accident|salvage|flood|odometer rollback)\b", flags=re.I),
    "opt_out": re.compile(r"\b(stop contact|unsubscribe|do not contact|don't contact|opt[- ]?out|block me)\b", flags=re.I),
    "finance": re.compile(r"\b(loan|finance|leasing|apr|down payment|emi|monthly payment|credit score|co-?signer)\b", flags=re.I),
    "warranty": re.compile(r"\b(warranty|gap insurance|extended warranty|powertrain|bumper to bumper)\b", flags=re.I),
    "tradein": re.compile(r"\b(trade[- ]?in|kbb|carmax|carvana|payoff|lien)\b", flags=re.I),
    "service": re.compile(r"\b(service|maintenance|recall|oil change|collision repair|loaner)\b", flags=re.I),
    "pii": re.compile(r"\b(ssn|social security|dob|date of birth|account number|routing number|bank account)\b", flags=re.I)
}

def local_prefilter_for_escalation(message: str) -> (bool, str):
    """
    Return (True, reason) if any high-confidence escalation trigger is found locally.
    """
    msg = (message or "").lower()
    for reason, pat in PREFILTER_PATTERNS.items():
        if pat.search(msg):
            return True, reason
    return False, ""

def classify_with_openai(message: str, context: str) -> dict:
    """
    Calls OpenAI to return single-line JSON: {"intent":"...","sentiment":"..."}
    Returns a dict with keys: intent, sentiment, source, raw.
    On parse error or any exception, returns Managerial Review as fail-safe.
    """
    try:
        user_text = CLASSIFIER_USER_TEMPLATE.format(
            message=(message or "").replace("\n", " "),
            context=(context or "").replace("\n", " ")
        )
        messages = [
            {"role": "system", "content": CLASSIFIER_SYSTEM},
            {"role": "user", "content": user_text}
        ]
        resp = openai.chat.completions.create(
            model="gpt-4o",        # choose appropriate model in production
            messages=messages,
            temperature=0.0,
            max_tokens=120,
            top_p=1.0
        )
        raw = resp.choices[0].message.content.strip()
        raw = raw.strip("`\n ").strip()
        try:
            parsed = json.loads(raw)
        except Exception:
            # Try to extract first {...} block
            import re as _re
            m = _re.search(r"\{.*\}", raw, flags=_re.S)
            if not m:
                raise
            parsed = json.loads(m.group(0))
        intent = parsed.get("intent", "").strip()
        sentiment = parsed.get("sentiment", "").strip()
        if intent not in ["Visit Requested", "Visit Suggested", "Visit Booked", "Managerial Review"]:
            raise ValueError("invalid_intent")
        if sentiment not in ["Positive", "Neutral", "Negative"]:
            raise ValueError("invalid_sentiment")
        return {"intent": intent, "sentiment": sentiment, "raw": raw, "source": "openai"}
    except Exception as e:
        logging.warning(f"\nClassifier parse issue: {e} -- raw_resp: {locals().get('raw','')}")
        # Heuristic: if the message looks like a shopping/make query,
        # prefer 'Visit Suggested' instead of escalation.
        msg_l = (message or "").lower()
        import re as _re
        vehicley = bool(_re.search(r"\b(show|see|find|search|look|showme|browse)\b", msg_l)) or \
                   bool(_re.search(r"\b(ford|toyota|honda|chevy|chevrolet|ram|gmc|bmw|mercedes|benz|audi|kia|hyundai|jeep|vw|volkswagen|nissan|lexus|subaru|mazda|volvo|porsche|tesla)\b", msg_l))
        if vehicley:
           return {"intent": "Visit Suggested", "sentiment": "Neutral", "raw": "", "source": "fallback_make_heuristic"}
        return {"intent": "Managerial Review", "sentiment": "Neutral", "raw": "", "source": "fallback_parse_error"}

#------------------RAG Function---------------------
'''
This function do following :
    1) Call getVDQ(): It will parse the response from GPT and create key:value pair for each vehicle.
    2) Create API URL and Web URL from the response from getVDQ()
        API URL is the query url to check if the data is exist in 3rd party api repository
        WebURL is the url which will show vehicle search result on UI.
    3) validate_n_generate(): It will trigger API URL and return the raw API response 
    4.) If API response comes then return GPT result with WebURL else it will return GPT result only to the calling functiom

'''

def RAG(question,vchatbotname,vdealername,vchatbotdealrurl):

    autopulse_api_key = os.getenv('AUTOPULSE_API_KEY')
    
    vapiurl=f"https://www.autopulse.ai/api/car?api_key={autopulse_api_key}&source="+vchatbotdealrurl
    vweburl="https://chat.autopulse.ai?"
    retryflag=0
    vinflag=0
    errorflag=0
    api_validate_flag=0
    
    #print(question)
    vvdq= getVDQ(question)
    strresp={}
    startmake=vvdq.find('"make":')
    
    #print(type(vvdq),"     startmake    ",startmake)

    if vvdq is None or startmake==-1:
        strresp["recordfound"]="No"
        strresp["exception"]=""
        strresp["weburl"]="No Data"
        strresp["apiurl"]="No Data"
        strresp["numofrecord"]="0"
        strresp["vehicle"]="No Data"
        strresp["jsondata"]=vvdq
        strresp["message"]=str("")
        return strresp

    #print("JSON key value pair : ",vvdq)
    logging.info(f"\nJSON key value pair: {vvdq}")
    
    try:
        json_data = json.loads(vvdq)

    except Exception as e:
        #print("validate_n_generate Exception if json load fails ",e)
        logging.error(f"\nJSON load failed: {e}")
        strresp["recordfound"]="No"
        strresp["exception"]=e
        strresp["weburl"]="No Data"
        strresp["apiurl"]="No Data"
        strresp["numofrecord"]="0"
        strresp["vehicle"]="No Data"
        strresp["jsondata"]=vvdq
        strresp["message"]=str("")
        return strresp
        
    try:
        # Attempt 1 to build url with all the parameters
        url=splitandbuild(vweburl,vapiurl,json_data,strresp,retryflag,vvdq)
        
        #print("The first api url is - ",url[0])
        #print("The first web url is - ",url[1])
        
        #Validation url with all the parameters built in attempt 1
        vdata=validate_n_generate(url[0])
        #print("The first attempt with the url with all parameters response is - ",vdata)
                
        if vdata.startswith("error"):
            errorflag=1
            #print("The first attempt with the url with all parameters error is - ",vdata)
        
        data= json.loads(vdata)
        
        #1st attempt check if we get error with the url with all the parameters
        if errorflag==0:
            vnum=int(data["num_found"])
            #print("1st attempt no error block")
            strresp["recordfound"]='No'
            strresp["weburl"]=url[1]
            strresp["apiurl"]=url[0]
            strresp["numofrecord"]=vnum
            strresp["exception"]=""
            strresp["jsondata"]=str(vvdq)
            strresp["message"]=str("")

            #1st attempt if we get record with the url with all the parameters
            if vnum >0:

                #print("#1st attempt if we get record with the url with all the parameters")
                strresp["recordfound"]='Yes'
                strresp["vehicle"]=data
                        
            #1st attempt if we did'nt get record
            elif vinflag==1:
                #if its vin then handle msg with flag
                #print("if its vin then handle msg with flag")
                strresp["vehicle"]="No VIN Found"
                
                url=splitandbuild(vweburl,vapiurl,json_data,strresp,retryflag,vvdq)
                #print("2nd attempt (with VIN) to get record-  api url is - ",url[0]," weburl is - ",url[1])
                vdata=validate_n_generate(url[0])
                errorflag=0
                if vdata.startswith("error"):
                    errorflag=1
                    #print("The second attempt (with VIN) error is - ",vdata)
                         
                else:
                    #in case of error on 2nd attempt
                    #print("#in case of no error on 2nd attempt with VIN")
                    strresp["recordfound"]="No"
                    strresp["exception"]=data
                    strresp["weburl"]="No Data"
                    strresp["apiurl"]="No Data"
                    strresp["numofrecord"]="0"
                    strresp["vehicle"]="No Data"
                    strresp["jsondata"]=vvdq
                    strresp["message"]=str("")

            #To sort RV/Trailer/Coach Class issue  -- Will be removed
            else:
                #retry with 2nd attempt with only make and class

                #print("#retry with 2nd attempt with only make and class")
                retryflag=1
                    
                url=splitandbuild(vweburl,vapiurl,json_data,strresp,retryflag,vvdq)
                
                #print("2nd attempt api url with make and class is - ",url[0]," & uweb url with make and class is -  ",url[1])
                vdata=validate_n_generate(url[0])

                if vdata.startswith("error"):
                    errorflag=1
                    #print("The second attempt with make & class error is - ",vdata)
                    
                data=json.loads(vdata)
                #2nd attempt with make and class when no error found in url response
                if errorflag==0:
                    #print("#2nd attempt with make and class when no error found in URL response")
                    vnum=int(data["num_found"])
                    #print(vnum)
                    strresp["recordfound"]='No'
                    strresp["weburl"]=url[1]
                    strresp["apiurl"]=url[0]
                    strresp["numofrecord"]=vnum
                    strresp["exception"]=""
                    strresp["jsondata"]=str(vvdq)
                    strresp["message"]=str("")

                    #3rd attempt if we get record
                    if vnum >0:
                        #print("#2nd attempt with make & class if we get record")
                        strresp["recordfound"]='Yes'
                        strresp["vehicle"]=data
                    else:
                        #2nd attempt if we did'nt get record
                        #print("#2nd attempt with make & class attempt if we did'nt get record")
                        strresp["vehicle"]="No Data"

        else:
            #in case of no error on 1st attempt with url with all paramters
            #print("#in case of no error on 1st attempt with url with all parameters")
            strresp["recordfound"]="Yes"
            #strresp["exception"]=data2
            strresp["weburl"]=vweburl
            strresp["apiurl"]=vapiurl
            strresp["numofrecord"]=vnum
            #strresp["vehicle"]="No Data"
            strresp["jsondata"]=vvdq
            strresp["message"]=str("")
    
        return strresp

    except Exception as e:
        #print("validate_n_generate Exception if attempt fails ",e)
        strresp["recordfound"]="No"
        strresp["exception"]=e
        strresp["weburl"]="No Data"
        strresp["apiurl"]="No Data"
        strresp["numofrecord"]="0"
        strresp["vehicle"]="No Data"
        strresp["jsondata"]=vvdq
        strresp["message"]=str("")
        return strresp                    

def parse_length(value):
    """Convert length like '5\'2"' or '5 feet 2 inches' to feet as an integer."""
    # Remove unwanted characters and normalize input
    value = value.lower().replace("feet", "").replace("foot", "").replace("inches", "").replace("'", " ").replace('"', "").strip()
    match = re.match(r"(\d+)\s*(\d+)?", value)
    if match:
        feet = int(match.group(1))
        inches = int(match.group(2)) if match.group(2) else 0
        total_inches = (feet * 12) + inches
        return total_inches / 12  # Convert to feet as float
    return 0

def calculate_length_range(length_in_feet):
    """Calculate the ±15% range for a given length."""
    lower_bound = length_in_feet * 0.85
    upper_bound = length_in_feet * 1.15
    return f"{int(lower_bound)}-{int(upper_bound)}"

def splitandbuild(vweburl,vapiurl,json_data,strresp,retryflag,vvdq):
    
    vinflag=0
        
    for key, value in json_data.items():
        logging.info(f"\nkey,value pair current: {key}, {value}")
        if len(json_data["make"])>0:
        
            if "vin" in json_data and len(json_data["vin"])>0:
                vinflag=1
                vvin=json_data["vin"]
                vapiurl += f"&vin={vvin}"
                vweburl += f"vin={vvin}"
                logging.info(f"\nVIN API URL: {vapiurl}")
                logging.info(f"\nVIN WEB URL: {vweburl}")
                break

            #Building API URL
            valuearr=json_data[key]
            
            # Skip processing if retryflag is 1 and the key is "model"
            if retryflag == 1 and key == "model":
                continue  # Skip this key when first URL call has failed

            # Handle "inventory_type" separately because api call allows either new or used
            if key == "inventory_type":
                if isinstance(value, list):
                    # For lists, take the first element
                    inventory_type = value[0]
                elif isinstance(value, str):
                    # If the value is a string and contains a comma, split and take the first part
                    inventory_type = value.split(",")[0].strip()    
                else:
                    # If it's a plain string (no comma or list), use as is
                    inventory_type = str(value).strip()
                    
                vapiurl += f"&{key}={inventory_type}"
                
            # Handle other keys
            elif key != "inventory_type":
                if isinstance(value, list):
                    # For lists, join items with commas
                    value_str = ",".join([str(item).strip('[]').strip() for item in value])
                    vapiurl += f"&{key}={value_str}"
                else:
                    # If it's a non-list value, just strip any unwanted characters
                    value_str = str(value).strip('[]').strip()
                    vapiurl += f"&{key}={value_str}"
                    
            #Building Web URL              
            # Adding the filter of length in a range of +/- 15%
            if key == "length" :
                # Parse and calculate length range
                length_in_feet = parse_length(value)
                length_range = calculate_length_range(length_in_feet)
                vweburl += f"length_range={length_range}" + "&"
            elif key == "inventory_type" :
                if isinstance(value, list):
                    # Take the first element from the list
                    inventory_type = value[0]
                elif isinstance(value, str) and ',' in value:
                    # Use partition to get everything before the first comma
                    inventory_type = value.partition(",")[0].strip()  # Get the first part before comma
                else:
                    inventory_type = str(value).strip()
                vweburl += f"inventory_type={inventory_type}" + "&"
            # Handling specific cases like price_range and year_range
            elif key in ["price_range", "year_range"]:
                # Directly add price_range or year_range to the URL
                vweburl += f"{key}={value}" + "&"
            elif key == "seating_capacity" :
                # Handle seating_capacity: convert list-like string to individual items
                input_str = value[1:-1]  # Strip square brackets
                v_list = [element.strip().replace("upto", "").lower() for element in input_str.split(",")]
                vweburl += f"{key}={','.join(v_list)}" + "&"  # Combine values without spaces
            else:
                # Handle other keys as lists of comma-separated values
                input_str = str(value).strip("[]")
                v_list = [element.strip().strip("'\"").replace(" ", "") for element in input_str.split(",")]  # Remove quotes/spaces
                #vweburl += f"{key}={','.join(v_list)}" + "&"  # Combine values without spaces
                for v in v_list:
                    vweburl += f"{key}[]={v}&"

        else:
            vapiurl = ""
            vweburl = ""

    if vweburl.endswith("&"):
        vweburl = vweburl[:-1]  # Remove trailing '&'
        vweburl = vweburl.replace("''", "").replace("\"\"", "")  # Remove any double quotes or empty quotes

    vapiurl=vapiurl.replace(", ",",")
    logging.info(f"\nWeb URL: {vweburl}")
    '''
    if vinflag==1:
        logging.info(f"\nVIN API URL PRE: {vapiurl}")
        logging.info(f"\nVIN WEB URL PRE: {vweburl}")
        #vapiurl = "https://www.autopulse.ai/api/car?vin="+vvin+"&source="+vchatbotdealrurl
        #vweburl="https://chat.autopulse.ai?vin="+vvin+"&source="+vchatbotdealrurl
        vapiurl=f"https://www.autopulse.ai/api/car?api_key={autopulse_api_key}&vin={vvin}"
        logging.info(f"\nVIn API URL: {vapiurl}")
        vweburl="https://chat.autopulse.ai?vin="+vvin+"&source="+vchatbotdealrurl
        logging.info(f"\nVIN WEB URL: {vweburl}")
   '''
    vurl=["test","test2"]

    vurl[0]=vapiurl
    vurl[1]=vweburl
    return vurl
        

#------------------validate_n_generate Function---------------------
'''
Input: 
    - vapiurl: API URL to trigger.
    
Description: 
This function performs the following tasks:
    1) Sends a GET request to the provided API URL (`vapiurl`).
    2) Parses the API response text into JSON format.
    3) Returns the raw API response text.
    4) In case of an exception, returns an error message with the exception details.
'''
 

def validate_n_generate(vapiurl):
    #print("validate_n_generate_Start ",datetime.now())
    vnum=0
    strresp={}
    try:
        import requests
        import json
        
        url=vapiurl

        payload = {}
        headers = {}
        #response = requests.request("POST", url, headers=headers, data=payload)
        response = requests.request("GET", url, headers=headers, data=payload)
        response_text = response.text

        data = json.loads(response_text)
        
        return response_text

    except Exception as e:
        #print("validate exception ",e)
        logging.error(f"\nURL validation error: {e}")
        
        return "error"+str(e)
        
#-----------------getVDQ Function---------------------
'''
Input: It takes input as GPT response in RAG function.
This function do following :
    1)Generate Key Value pair using OpenAI's GPT model to generate JSON representations based on user input.
'''    

def getVDQ(vtext):
    #print("getVDQ_start",datetime.now())

    try:
        gpt_assistant_prompt = """You are a JSON generator who creates parameter-wise vehicle details in English using the parameters listed below. Always group multiple `model` and `body_type` values into arrays within a single JSON object.

    ### Instruction:
        - Always generate a single JSON object with arrays for `model` and `body_type` if multiple values are provided.
        - Include only the parameters present in the input text; omit any unspecified parameters.
        - Set inventory_type` to `["new"] or inventory_type to ["used"]` when explicitly specified in user query else skip it

    ### Parameters:
    make:
    model: Include as an array if multiple models are mentioned.
    vin:
    inventory_type: 
    transmission: ["Automatic", "CVT", "Manual"]
    year_range: (e.g., 2000-2010)
    body_type: Include as an array if multiple body_types are mentioned.
    body_type_subtype: ["Extended", "Regular", "Crew", "Compact", "Luxury"]
    base_interior_color: ["Black", "Gray", "Beige", "Brown", "Red", "White", "Blue", "Silver", "Yellow", "Green", "Orange", "Gold", "Purple", "Unknown", "Pink"]
    base_exterior_color: ["White", "Black", "Gray", "Silver", "Blue", "Red", "Green", "Brown", "Beige", "Orange", "Gold", "Yellow", "Purple", "Pink", "Unknown"]
    price_range: (e.g., 0-10000)
    length_range:20-30

    ### Examples:

    #### Input 1:
    Dutchmen Astoria: Includes models Travel Trailer and Fifth Wheel, suitable for all seasons.

    #### Output 1:
    {
        "make": "Dutchmen",
        "model": ["Astoria Travel Trailer", "Astoria Fifth Wheel"],
        "body_type": ["Travel Trailer", "Fifth Wheel"],
        "length_range":"15-30"
    }

    #### Input 2:
    Forest River Rockwood: A versatile travel trailer perfect for families, priced at $20,000.

    #### Output 2:
    {
        "make": "Forest River",
        "model": ["Rockwood"],
        "body_type": ["Travel Trailer"],
        "price_range": "10000-30000",
        "length_range":"15-30"
    }

    #### Input 3:
    Decode the VIN 1FDWE35LXJHC51234.

    #### Output 3:
    {
        "vin": "1FDWE35LXJHC51234"
    }

    If the input text provides only some of these details, generate JSON with the available parameters only, grouping `model` and `body_type` values into arrays if applicable.

        """
        gpt_user_prompt = vtext 
        gpt_prompt = gpt_assistant_prompt, gpt_user_prompt
        
        message=[{"role": "assistant", "content": gpt_assistant_prompt}, {"role": "user", "content": gpt_user_prompt}]
        response =openai.chat.completions.create(
            model="gpt-4-turbo",
            messages = message,
            temperature=0.1,
            frequency_penalty=0.0
        )
        #print("getVDQ_end ",datetime.now())

        return response.choices[0].message.content
    
    except Exception as e:
        #print("An error occurred:", e)
        return None
    

# Define a function to create a summary of the conversation
def summarize_conversation(conversation):
    llm = ChatOpenAI(model_name="gpt-3.5-turbo", temperature=0)
    from langchain_core.prompts import PromptTemplate

    template = """You are smart AI Assistant who helps to summarize the given context in 1000 token:
    
    Question: {question}

    """

    custom_rag_prompt = PromptTemplate.from_template(template)

    rag_chain = (
        {"question": RunnablePassthrough()}
        | custom_rag_prompt
        | llm
        | StrOutputParser()
    )


    summary=rag_chain.invoke(conversation)

    return summary

def generate_conversation_id():
    return str(uuid.uuid4())

def calculate_tokens(text, model_name="gpt-4o"):
    encoding = tiktoken.encoding_for_model(model_name)
    tokens = encoding.encode(text)
    return len(tokens)

def update_conversation(conversation_id, response, response_token,response_URL):
    try:
        connection = mysql.connector.connect(
                host=os.getenv('MYSQL_HOST'),
                database=os.getenv('MYSQL_DATABASE'),
                user=os.getenv('MYSQL_USER'),
                password=os.getenv('MYSQL_PASSWORD'))
        
        if connection.is_connected():
            cursor = connection.cursor()
            update_query = """
            UPDATE conversations
            SET response = %s,
                response_token = %s,
                response_timestamp = %s,
                URL = %s
            WHERE conversation_id = %s
            """
            response_timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
            cursor.execute(update_query, (response, response_token, response_timestamp, conversation_id,response_URL))
            connection.commit()
    except Error as e:
        #print(f"Error while connecting to MySQL: {e}")
        logging.error(f"\nMySQL connection error: {e}")
    finally:
        if connection.is_connected():
            cursor.close()
            connection.close()

def insert_conversation(conversation_id, request_token, request_timestamp, request, response, response_token, response_timestamp, context, followup_id, nlp_threshold,url,additional_info,exp):
    try:
        connection = mysql.connector.connect(
            host=os.getenv('MYSQL_HOST'),
            database=os.getenv('MYSQL_DATABASE'),
            user=os.getenv('MYSQL_USER'),
            password=os.getenv('MYSQL_PASSWORD')
        )

        if connection.is_connected():
            cursor = connection.cursor()
            sql_insert_query = """
            INSERT INTO conversations (conversation_id, request_token, request_timestamp, request, response, response_token, response_timestamp, context, followup_id, nlp_threshold,URL,additional_info,api_url)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s,%s,%s,%s)
            """
            record = (conversation_id, request_token, request_timestamp, request, response, response_token, response_timestamp, context, followup_id, nlp_threshold,url,additional_info,exp)
            cursor.execute(sql_insert_query, record)
            connection.commit()
    except Error as e:
        #print(f"Error while connecting to MySQL: {e}")
        logging.error(f"MySQL connection error: {e}")
    finally:
        if connection.is_connected():
            cursor.close()
            connection.close()

def format_response(question):
    #print("format_response_start",datetime.now())
    try:

        gpt_assistant_prompt="""You are AI Formatter. Convert the input into the following JSON format where any text that needs to be bold is prefixed with **:
        {
            "heading": "Main Heading",
            "subheading": "Subheading",  
            "paragraphs": [
                "This is the first paragraph.",  
                "This is the second paragraph with more ."
            ],
            "list": [
                "First item in the list",  
                "Second item in the ",
                "Third item in the list"  
            ]
        }

        """

        gpt_user_prompt = question 
        gpt_prompt = gpt_assistant_prompt, gpt_user_prompt
        
        message=[{"role": "assistant", "content": gpt_assistant_prompt}, {"role": "user", "content": gpt_user_prompt}]
        response =openai.chat.completions.create(
            model="gpt-4o",
            messages = message,
            temperature=0.1,
            max_tokens=4096,
            frequency_penalty=0.0
        )
        #print("format_response_end",datetime.now()," html ",response)

        return response
    except Exception as e:
        #print(f"An error occurred: {e}")
        return None


def generate_answer(question,context,vchatbotname,vdealername):
    
    #print("generate_answer_start",datetime.now())
    varchatbotname=vchatbotname
    vardealername=vdealername

    gpt_assistant_prompt = f"""
You are {varchatbotname}, a warm, friendly, and engaging professional AI sales assistant helping USA-based customers with automobile-related queries. 

🎯 **Main Goal:** Encourage the customer to **book an appointment or visit {vardealername}**. 

---

### Tone & Style
- Warm, conversational, and professional. Add light personality (😊, 🚗) without being over the top.  
- Use short replies: max 2–3 sentences.  
- Be positive and encouraging: “Great choice!”, “Awesome!”, “Got you covered!”.  
- Always sound helpful and confident, never pushy.  

---

### Core Behaviors
1. **Vehicle Queries:**  
   - Confirm make, model, or type clearly.  
   - If VIN provided, decode into make, model, year, engine, and key specs.  
   - If user specifies *new* or *used*, explicitly label each suggestion with **car type: New** or **car type: Used**.  

2. **Sales-Driving CTAs:**  
   - End *every response* with 2–3 clear CTAs.  
   - Primary CTA must be an **appointment booking / test drive**.  
   - Other CTAs: trim options, financing, colors, trade-in, comparisons.  
   - Phrase CTAs as friendly open-ended questions:  
     - “Would you like me to schedule a quick test drive?”  
     - “Want me to check financing or send trim options?”  

3. **Conversation Guidance:**  
   - Begin with a friendly greeting (“Hi there! 👋”).  
   - Mention {vardealername} naturally for trust.  
   - If user seems unsure, offer suggestions: trims, comparisons, or test drives.  
   - Always end with a warm, open-ended question that invites a reply.  
 
4. **Non-Auto or Escalation-Only Queries:**
   - If the query is unrelated to automobiles (e.g., sports, weather, politics): 
     Respond with: "Sorry, I am only trained to answer questions related to automobiles."
   - If the query is automobile-related but requires a specialist (Carfax/vehicle history, financing/leasing, rebates, taxes/DMV, warranty, trade-in, EV charging, service, compliance/legal): 
     Respond briefly, acknowledge the request, and inform the user a specialist will reach out. 
     Example: "Thanks for asking! A specialist from {vardealername} will reach out shortly to help with financing. Meanwhile, would you like me to reserve a test drive slot for you?"

5. **Language Handling:**  
   - Respond in the same language the user uses.  

6. **Where to Buy Guidance:**  
   - If asked about where to purchase:  
     - Say: “{vardealername} is the best platform for purchasing a new or used vehicle. You can find vehicles near you, send a quick request to dealers, and they’ll take care of the rest.”  

---

### Response Quality
- Keep all responses short, engaging, and informative.  
- Always tie back to **the next step toward an appointment**.  
- Use {vardealername} naturally as the trusted dealership.  
- Stay within max token limits.  
"""
    try:
        if not context:
            gpt_assistant_prompt = f"""
You are {varchatbotname}, a warm, friendly, and engaging professional AI sales assistant helping USA-based customers with automobile-related queries. 

🎯 **Main Goal:** Encourage the customer to **book an appointment or visit {vardealername}**. 

---

### Tone & Style
- Warm, conversational, and professional. Add light personality (😊, 🚗) without being over the top.  
- Use short replies: max 2–3 sentences.  
- Be positive and encouraging: “Great choice!”, “Awesome!”, “Got you covered!”.  
- Always sound helpful and confident, never pushy.  

---

### Core Behaviors
1. **Vehicle Queries:**  
   - Confirm make, model, or type clearly.  
   - If VIN provided, decode into make, model, year, engine, and key specs.  
   - If user specifies *new* or *used*, explicitly label each suggestion with **car type: New** or **car type: Used**.  

2. **Sales-Driving CTAs:**  
   - End *every response* with 2–3 clear CTAs.  
   - Primary CTA must be an **appointment booking / test drive**.  
   - Other CTAs: trim options, financing, colors, trade-in, comparisons.  
   - Phrase CTAs as friendly open-ended questions:  
     - “Would you like me to schedule a quick test drive?”  
     - “Want me to check financing or send trim options?”  

3. **Conversation Guidance:**  
   - Begin with a friendly greeting (“Hi there! 👋”).  
   - Mention {vardealername} naturally for trust.  
   - If user seems unsure, offer suggestions: trims, comparisons, or test drives.  
   - Always end with a warm, open-ended question that invites a reply.  
 
4. **Non-Auto or Escalation-Only Queries:**
   - If the query is unrelated to automobiles (e.g., sports, weather, politics): 
     Respond with: "Sorry, I am only trained to answer questions related to automobiles."
   - If the query is automobile-related but requires a specialist (Carfax/vehicle history, financing/leasing, rebates, taxes/DMV, warranty, trade-in, EV charging, service, compliance/legal): 
     Respond briefly, acknowledge the request, and inform the user a specialist will reach out. 
     Example: "Thanks for asking! A specialist from {vardealername} will reach out shortly to help with financing. Meanwhile, would you like me to reserve a test drive slot for you?"

5. **Language Handling:**  
   - Respond in the same language the user uses.  

6. **Where to Buy Guidance:**  
   - If asked about where to purchase:  
     - Say: “{vardealername} is the best platform for purchasing a new or used vehicle. You can find vehicles near you, send a quick request to dealers, and they’ll take care of the rest.”  

---

### Response Quality
- Keep all responses short, engaging, and informative.  
- Always tie back to **the next step toward an appointment**.  
- Use {vardealername} naturally as the trusted dealership.  
- Stay within max token limits.  
"""
                           
        else:
            gpt_assistant_prompt+="\n previous chat history:  "+context
            
        gpt_user_prompt = question 
        gpt_prompt = gpt_assistant_prompt, gpt_user_prompt
        message=[{"role": "assistant", "content": gpt_assistant_prompt}, {"role": "user", "content": gpt_user_prompt}]
        response =openai.chat.completions.create(
            model="gpt-4o",
            messages = message,
            temperature=0.1,
            max_tokens=4096,
            frequency_penalty=0.0
        )
        #print("generate_answer_end",datetime.now())
        return response
    except Exception as e:
        #print(f"An error occurred: {e}")
        return None

# To support Multilingual 
def multilingual_process(question,detected_lang):
    try:
        if detected_lang == "":
            # Detect the language of the input
            detected_lang = detect(question)
            #print("Original question: ",question)
            #print("Detected language: ",detected_lang)
            
            # Translate if the language is not English
            if detected_lang != 'en':
                question = GoogleTranslator(source=detected_lang, target='en').translate(question)
                #print("Translated question: ",question)
                return question, detected_lang
            else:
                #print("No translation needed; question is in English.")
                return question, 'en'
            
        else:
            #print("English Response: ", question)
            #print("Original language: ",detected_lang)

            # Translate if the language is not English
            if detected_lang != 'en':
                question = GoogleTranslator(source='en', target=detected_lang).translate(question)
                #print("Translated response: ",question)
                return question, detected_lang
            else:
                #print("No translation needed; question was asked in English.")
                return question, 'en'
    
    except LangDetectException:
        logging.error("\nError detecting language.")
        #print("Error detecting language.")
        return question, 'unknown'
    except Exception as e:
        logging.error(f"\nTranslation error: {e}")
        #print("Translation error:",e)
        return question, 'en'  # Return the original question if translation fails

    
# ----------------- Booking decision helper (optional, used elsewhere) -----------------
BOOKING_KEYWORDS = re.compile(
    r"\b(book(ing|ed)?|schedule|reserve|test ?drive|appointment|visit|hold (the|it)|i'll come|i will come|see it in person|can I come|set up a visit|book a slot|available slot|time slot)\b",
    flags=re.I
)
TIME_PATTERNS = re.compile(r"\b(morning|afternoon|evening|tonight|tomorrow|today|mon(day)?|tue(sday)?|wed(nesday)?|thu(rs)?|fri(day)?|sat(urday)?|sun(day)?|\d{1,2}(:\d{2})?\s*(am|pm)?)\b", flags=re.I)
INTEREST_KEYWORDS = re.compile(
    r"\b(interested|considering|thinking of|want(ed)? to buy|looking to buy|price range|budget|finance|emi|best for|recommend|compare|compare with|family|commute|mileage)\b",
    flags=re.I
)

def decide_booking_or_escalate(user_message: str, classifier: dict, context: str = "") -> dict:
    if classifier.get("intent") == "Managerial Review":
        return {"branch": "escalate", "reason": "classifier_escalate", "score": 1.0}
    text = (user_message or "") + " " + (context or "")
    text = text.strip()
    if BOOKING_KEYWORDS.search(text) or TIME_PATTERNS.search(text):
        if re.search(r"\b(not|don't|do not|no way|not ready|not now)\b", text, flags=re.I):
            pass
        else:
            return {"branch": "book", "reason": "explicit_booking_keyword_or_time", "score": 0.95}
    score = 0
    if INTEREST_KEYWORDS.search(text):
        score += 1
    if re.search(r"\b(price|cost|msrp|how much|emi|monthly|finance|down payment|trade-in)\b", text, flags=re.I):
        score += 1
    if re.search(r"\b(photo|video|walk[- ]?around|interior|exterior|inspection|service history|carfax|autocheck)\b", text, flags=re.I):
        score += 0.5
    if re.search(r"\b(buy(ing)? (this|one|soon)|this month|next week|this week)\b", text, flags=re.I):
        score += 1
    if score >= 2:
        return {"branch": "suggest", "reason": f"interest_score={score}", "score": float(min(score / 4.0, 0.99))}
    return {"branch": "normal", "reason": f"low_score={score}", "score": float(score / 4.0)}

@app.route('/process', methods=['POST'])
def process_request():
    
    #---------Get Body data from request-------------------
    data = request.json
    logging.info(f"\nFull payload received: {json.dumps(data, indent=2, default=str)}")
    #logging.info(f"\nReceived request: {data}")
    #print("request data is ",data)
    question = data.get('request')
    context = data.get('context', "")
    logging.info(f"\nReceived question: {question}")
    #logging.info(f"\nReceived context: {context}")
    # --- New: personalize with customer name (a) ---
    customer_name = (data.get("customer_name") or data.get("name") or "").strip()
    first_name = re.split(r"\s+", customer_name)[0] if customer_name else ""
    logging.info(f"\nReceived name: {customer_name}")
    logging.info(f"\nReceived first name: {first_name}")

    context_from_payload = data.get("context", "") or ""
    logging.info(f"\nReceived context: {context_from_payload}")

    if first_name:
        personalization_note = f"Customer name: {first_name}. Address them casually by first name in your reply."
        context_for_generation = (personalization_note + "\n" + context_from_payload).strip()
    else:
        context_for_generation = context_from_payload

    # Keep pristine for classifier
    context_for_classifier = context_from_payload
    # --- END personalization + context split (a) ---
    
    detected_lang = ""

    # To support Multilingual 
    #question = multilingual_process(question,detected_lang)
    
    context_tokens=0
    vdealername=data.get('dealership_name',"")
    vchatbotname=data.get('chatbotname',"")
    vchatbotdealrurl=data.get('dealersouce',"")
    vuserid=data.get('userid',"")

    #-----check if VIN number is given---------------
    # Search for the pattern in the user's query
    vin_pattern = r'\b[A-HJ-NPR-Z0-9]{17}\b'
    #vin_pattern = r'(?<![A-HJ-NPR-Z0-9])[A-HJ-NPR-Z0-9]{17}(?![A-HJ-NPR-Z0-9])' 
    vinflag=0
    vin='novin'
    match = re.search(vin_pattern, question)
    logging.info(f"\nIs it a VIN no: {match}")

    #-------------Check if its a new or follow-up call------
    if context:
        conversation_id = data.get('conversation_id')
        followup_id= conversation_id
        context_tokens = calculate_tokens(context)
    else:
        followup_id=""
    if not question:
        return jsonify({"error": "Request is required"}), 400
    
    conversation_id = data.get('conversation_id')
    
    request_timestamp = datetime.now()
    request_token = calculate_tokens(question)
    
    #-----------------Set and call NLP -------------------
    assistant_prompt = "Automobile related information only"
    assistant_prompt_doc = nlp(assistant_prompt)
    api_response_doc = nlp(question)
    similarity = assistant_prompt_doc.similarity(api_response_doc)
    threshold = 0.50
    
    # Ensure the total tokens used is within model limits
    if context_tokens > 2000:  # Keeping a buffer to avoid hitting the limit               
        context = summarize_conversation(context)
    response_url=""
    #--------------------Check threshold value-------------------------
    if similarity > threshold:
        response_url=""
    else:
        #--------------------Respond as not a related question-------------
        response = "Question is not relevant to this platform."
        
    #Generate new conversation id for a new conversation
    if not conversation_id:
        conversation_id = generate_conversation_id()

    # ----- small integration: intent/sentiment classification via OpenAI -----
    prefilter_hit, prefilter_reason = local_prefilter_for_escalation(question)
    if prefilter_hit:
        classifier = {"intent": "Managerial Review", "sentiment": "Neutral", "raw": "", "source": "prefilter:" + prefilter_reason}
        logging.info(f"\nPrefilter triggered escalation: {prefilter_reason}")
    else:
        classifier = classify_with_openai(question, context_for_classifier)
        #logging.info(f"\nOpenAI classifier output: {classifier}")
        # --- Step 4: Guard against classifier parse failures ---
        try:
            assert isinstance(classifier, dict) and "intent" in classifier
        except Exception as e:
            logging.error("Classifier error or parse failure: %r -- raw_resp: %s", e, classifier)
            classifier = {
                "intent": "Unknown",
                "sentiment": "Neutral",
                "raw": str(classifier),
                "source": "classifier_error"
            }
        # --- End guard ---

        # now safe to use classifier["intent"]

    # Decide booking vs suggestion vs escalate vs normal
    booking_decision = decide_booking_or_escalate(question, classifier, context)
    logging.info(f"\nBooking decision: {booking_decision}")

    # If classifier says Managerial Review -> escalation flow
    # but ONLY when a risk prefilter actually triggered.
    if classifier.get("intent") == "Managerial Review" and (
        prefilter_hit or str(classifier.get("source", "")).startswith("prefilter:")
    ):
        template_key = "generic_escalation"
        # Map prefilter reason to template key if possible
        if prefilter_hit:
            mapped_key = "managerial_review_" + prefilter_reason
            if mapped_key in AUTO_REPLY_TEMPLATES:
                template_key = mapped_key
        tpl = AUTO_REPLY_TEMPLATES.get(template_key, AUTO_REPLY_TEMPLATES["generic_escalation"])
        tpl = tpl.replace("[DEALER_NAME]", vdealername or "the dealership")
        vehicle_url = ""
        if classifier.get("raw") and data.get("vehicle_url"):
            vehicle_url = data.get("vehicle_url")
        elif data.get("weburl"):
            vehicle_url = data.get("weburl")
        if vehicle_url and "do not contact" not in question.lower():
            tpl = tpl.replace("[VEHICLE_URL]", redact_url(vehicle_url))
        else:
            tpl = tpl.replace(" Meanwhile you can view details here: [VEHICLE_URL]", "")
        ticket = {
            "conversation_id": conversation_id,
            "user_message": question,
            "classifier": classifier,
            "created_at": datetime.now().isoformat()
        }
        logging.info(f"\nEscalation ticket (auto-created): {json.dumps(redact_dict(ticket))}")
        insert_conversation(conversation_id, request_token, request_timestamp, json.dumps(redact_dict(data)), tpl, calculate_tokens(tpl), request_timestamp, context, followup_id, similarity, vehicle_url, json.dumps({"response": tpl}), vuserid)
        return jsonify({"conversation_id": conversation_id, "response": tpl, "manager_review": True, "ticket": ticket})

    # If booking-direct branch
    if booking_decision["branch"] == "book":
        booking_templates = [
            "Great — I can book a 30-min test drive for you. Available slots: Morning (9–11), Afternoon (12–3), Evening (5–7). Which works?",
            "Awesome — shall I reserve a test drive slot for you? Morning/Afternoon/Evening or pick a time that suits you."
        ]
        chosen = booking_templates[0] if (hash(conversation_id) % 2 == 0) else booking_templates[1]
        insert_conversation(conversation_id, request_token, request_timestamp, json.dumps(redact_dict(data)), chosen, calculate_tokens(chosen), request_timestamp, context, followup_id, similarity, "", json.dumps({"response": chosen}), vuserid)
        return jsonify({"conversation_id": conversation_id, "response": chosen, "booking_suggested": True})

    # If suggestion branch (soft suggestion + CTAs)
    if booking_decision["branch"] == "suggest":
        suggestion_templates = [
            "It sounds like you're leaning towards this model. Would you like me to (a) book a 30-min test drive, (b) send photos, or (c) show financing options?",
            "Great choice — I can book a test drive to help you decide, or send photos and a price breakdown. Which would you prefer?"
        ]
        chosen = suggestion_templates[hash(conversation_id) % len(suggestion_templates)]
        ctas = ["Book test drive", "Send photos", "Show EMI options"]
        insert_conversation(conversation_id, request_token, request_timestamp, json.dumps(redact_dict(data)), chosen, calculate_tokens(chosen), request_timestamp, context, followup_id, similarity, "", json.dumps({"response": chosen}), vuserid)
        return jsonify({"conversation_id": conversation_id, "response": chosen, "ctas": ctas, "booking_suggested": True})

    #Pass context if not a VIN related query
    if match==None:
        answer = generate_answer(question,context_for_generation,vchatbotname,vdealername)
    else:
        answer = generate_answer(question,"",vchatbotname,vdealername)
        
    finalresponse=answer.choices[0].message.content       
    rawoutput= finalresponse.strip().replace("\n", "")
    startpos=rawoutput.find("How can I assist you")
    if startpos>=0:
        finalresponse=""
        response=rawoutput
        response_token = calculate_tokens(response)
        response_url=""
        recordfound="No"
        weburl=""
        apiurl=""
        vehicle=""

        #Generate new conversation id for a new conversation
        if not conversation_id:
            conversation_id = generate_conversation_id()
            
        serialized_data = json.dumps(data)
        response=str(finalresponse)
        response_token = calculate_tokens(response)
        
        # Insert new conversation record in the database with a new conversation id
        insert_conversation(conversation_id, request_token, request_timestamp, serialized_data, finalresponse, response_token, request_timestamp, context, followup_id, similarity,response_url, json.dumps({"response": finalresponse}),"")

        # To support Multilingual 
        #question = multilingual_process(finalresponse,detected_lang)
        
        # Return JSON response
        return jsonify({"conversation_id": conversation_id, "response": finalresponse,"rawoutput": rawoutput,"recordFound":recordfound,"weburl":weburl,"vehicle":vehicle,"context":context,"apiurl":apiurl})
      
    else:
        if not conversation_id:
            conversation_id = generate_conversation_id()
        finalresponse=format_response(rawoutput).choices[0].message.content
        
        finalresponse= finalresponse.strip().replace("\n", "")
        finalresponse=finalresponse.replace("```json","")
        finalresponse=finalresponse.replace("```","")
        #print("The HTML \n ",finalresponse)
        logging.info(f"\nFinal Response: {finalresponse}")
        
        responselist=RAG(answer.choices[0].message.content,vchatbotname,vdealername,vchatbotdealrurl)
        response=str(responselist)
        response_token = calculate_tokens(response)
        serialized_data = json.dumps(data)
        response_url=responselist.get("weburl")
        dbresponse=str({"Message":responselist.get("message"),"recordFound":responselist.get("recordfound"),"weburl":responselist.get("weburl"),"context":context,"apiurl":responselist.get("apiurl")})
        #print("db response : ",dbresponse)
        logging.info(f"\nDB Response: {dbresponse}")
        insert_conversation(conversation_id, request_token, request_timestamp, serialized_data, dbresponse, response_token, request_timestamp, context, followup_id, similarity,response_url, json.dumps({"response": finalresponse}),vuserid+" \n "+str(responselist.get("exception"))+"\n"+str(responselist.get("jsondata")))
        # To support Multilingual
        #finalresponse = multilingual_process(finalresponse,detected_lang)
              
        if responselist.get("vehicle")=="No VIN Found":
            return jsonify({"Message":responselist.get("message"),"conversation_id": conversation_id, "response": "","rawoutput": rawoutput,"RecordFound":responselist.get("recordfound"),"weburl":responselist.get("weburl"),"vehicle":"","context":context,"apiurl":responselist.get("apiurl")})
        else:
            return jsonify({"Message":responselist.get("message"),"conversation_id": conversation_id, "response": finalresponse,"rawoutput": rawoutput,"RecordFound":responselist.get("recordfound"),"weburl":responselist.get("weburl"),"vehicle":responselist.get("vehicle"),"context":context,"apiurl":responselist.get("apiurl")})
   
if __name__ == "__main__":
    #app.run(debug=True)
    app.run(debug=True, host='0.0.0.0', port=8000)
