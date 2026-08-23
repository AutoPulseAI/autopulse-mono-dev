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

# LangChain imports (using direct imports instead of hub)
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.document_loaders import WebBaseLoader
from langchain_community.vectorstores import Chroma
from langchain_core.output_parsers import StrOutputParser
from langchain_core.runnables import RunnablePassthrough
from langchain_openai import ChatOpenAI, OpenAIEmbeddings
from langchain_core.documents import Document
from langchain_core.prompts import PromptTemplate

import os
from datetime import datetime
from dotenv import load_dotenv
import requests
import logging
from logging.config import fileConfig
import re

# To support Multilingual
from langdetect import detect, LangDetectException
from deep_translator import GoogleTranslator

load_dotenv()

app = Flask(__name__)
CORS(app, support_credentials=False)

# Commented for Dev testing
# logconfpath=os.getenv('LOG_CONF_PATH'),

# Set up logging
logging.basicConfig(
    filename='autopulse_chatbot.log',  # store in current folder
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)

# fileConfig(logconfpath)

# Load English language model
try:
    nlp = spacy.load("en_core_web_md")
except OSError:
    logging.warning("spaCy model 'en_core_web_md' not found. Please install it with: python -m spacy download en_core_web_md")
    nlp = None

os.environ["OPENAI_API_KEY"] = str(os.getenv('OPENAI_API_KEY'))
os.environ["CURL_CA_BUNDLE"] = ""

# Set up your OpenAI API key
openai.api_key = os.getenv('OPENAI_API_KEY') 

#------------------RAG Function---------------------
def RAG(question, vchatbotname, vdealername, vchatbotdealrurl):
    autopulse_api_key = os.getenv('AUTOPULSE_API_KEY')
    
    vapiurl = f"https://www.autopulse.ai/api/car?api_key={autopulse_api_key}&source=" + vchatbotdealrurl
    vweburl = "https://chat.autopulse.ai?"
    retryflag = 0
    vinflag = 0
    errorflag = 0
    
    vvdq = getVDQ(question)
    strresp = {}
    startmake = vvdq.find('"make":') if vvdq else -1

    if vvdq is None or startmake == -1:
        strresp["recordfound"] = "No"
        strresp["exception"] = ""
        strresp["weburl"] = "No Data"
        strresp["apiurl"] = "No Data"
        strresp["numofrecord"] = "0"
        strresp["vehicle"] = "No Data"
        strresp["jsondata"] = vvdq
        strresp["message"] = str("")
        return strresp

    logging.info(f"\nJSON key value pair: {vvdq}")
    
    try:
        json_data = json.loads(vvdq)
    except Exception as e:
        logging.error(f"\nJSON load failed: {e}")
        strresp["recordfound"] = "No"
        strresp["exception"] = str(e)
        strresp["weburl"] = "No Data"
        strresp["apiurl"] = "No Data"
        strresp["numofrecord"] = "0"
        strresp["vehicle"] = "No Data"
        strresp["jsondata"] = vvdq
        strresp["message"] = str("")
        return strresp
        
    try:
        # Attempt 1 to build url with all the parameters
        url = splitandbuild(vweburl, vapiurl, json_data, strresp, retryflag, vvdq, vchatbotdealrurl)
        
        # Validation url with all the parameters built in attempt 1
        vdata = validate_n_generate(url[0])
                
        if vdata.startswith("error"):
            errorflag = 1
        
        data = json.loads(vdata)
        
        # 1st attempt check if we get error with the url with all the parameters
        if errorflag == 0:
            vnum = int(data["num_found"])
            strresp["recordfound"] = 'No'
            strresp["weburl"] = url[1]
            strresp["apiurl"] = url[0]
            strresp["numofrecord"] = vnum
            strresp["exception"] = ""
            strresp["jsondata"] = str(vvdq)
            strresp["message"] = str("")

            # 1st attempt if we get record with the url with all the parameters
            if vnum > 0:
                strresp["recordfound"] = 'Yes'
                strresp["vehicle"] = data
                        
            # 1st attempt if we didn't get record
            elif vinflag == 1:
                strresp["vehicle"] = "No VIN Found"
                
                url = splitandbuild(vweburl, vapiurl, json_data, strresp, retryflag, vvdq, vchatbotdealrurl)
                vdata = validate_n_generate(url[0])
                errorflag = 0
                if vdata.startswith("error"):
                    errorflag = 1
                else:
                    strresp["recordfound"] = "No"
                    strresp["exception"] = data
                    strresp["weburl"] = "No Data"
                    strresp["apiurl"] = "No Data"
                    strresp["numofrecord"] = "0"
                    strresp["vehicle"] = "No Data"
                    strresp["jsondata"] = vvdq
                    strresp["message"] = str("")

            # To sort RV/Trailer/Coach Class issue -- Will be removed
            else:
                # retry with 2nd attempt with only make and class
                retryflag = 1
                url = splitandbuild(vweburl, vapiurl, json_data, strresp, retryflag, vvdq, vchatbotdealrurl)
                vdata = validate_n_generate(url[0])

                if vdata.startswith("error"):
                    errorflag = 1
                    
                data = json.loads(vdata)
                # 2nd attempt with make and class when no error found in url response
                if errorflag == 0:
                    vnum = int(data["num_found"])
                    strresp["recordfound"] = 'No'
                    strresp["weburl"] = url[1]
                    strresp["apiurl"] = url[0]
                    strresp["numofrecord"] = vnum
                    strresp["exception"] = ""
                    strresp["jsondata"] = str(vvdq)
                    strresp["message"] = str("")

                    # 3rd attempt if we get record
                    if vnum > 0:
                        strresp["recordfound"] = 'Yes'
                        strresp["vehicle"] = data
                    else:
                        # 2nd attempt if we didn't get record
                        strresp["vehicle"] = "No Data"
        else:
            # in case of no error on 1st attempt with url with all parameters
            strresp["recordfound"] = "Yes"
            strresp["weburl"] = vweburl
            strresp["apiurl"] = vapiurl
            strresp["numofrecord"] = vnum
            strresp["jsondata"] = vvdq
            strresp["message"] = str("")
    
        return strresp

    except Exception as e:
        logging.error(f"RAG function exception: {e}")
        strresp["recordfound"] = "No"
        strresp["exception"] = str(e)
        strresp["weburl"] = "No Data"
        strresp["apiurl"] = "No Data"
        strresp["numofrecord"] = "0"
        strresp["vehicle"] = "No Data"
        strresp["jsondata"] = vvdq
        strresp["message"] = str("")
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

def splitandbuild(vweburl, vapiurl, json_data, strresp, retryflag, vvdq, vchatbotdealrurl=""):
    vinflag = 0
    autopulse_api_key = os.getenv('AUTOPULSE_API_KEY')
        
    for key, value in json_data.items():
        logging.info(f"\nkey,value pair current: {key}, {value}")
        if len(json_data["make"]) > 0:
        
            if "vin" in json_data and len(json_data["vin"]) > 0:
                vinflag = 1
                vvin = json_data["vin"]
                vapiurl += f"&vin={vvin}"
                vweburl += f"vin={vvin}"
                logging.info(f"\nVIN API URL: {vapiurl}")
                logging.info(f"\nVIN WEB URL: {vweburl}")
                break

            # Building API URL
            valuearr = json_data[key]
            
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
                    
            # Building Web URL              
            # Adding the filter of length in a range of +/- 15%
            if key == "length":
                # Parse and calculate length range
                length_in_feet = parse_length(value)
                length_range = calculate_length_range(length_in_feet)
                vweburl += f"length_range={length_range}" + "&"
            elif key == "inventory_type":
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
            elif key == "seating_capacity":
                # Handle seating_capacity: convert list-like string to individual items
                input_str = value[1:-1]  # Strip square brackets
                v_list = [element.strip().replace("upto", "").lower() for element in input_str.split(",")]
                vweburl += f"{key}={','.join(v_list)}" + "&"  # Combine values without spaces
            else:
                # Handle other keys as lists of comma-separated values
                input_str = str(value).strip("[]")
                v_list = [element.strip().strip("'\"").replace(" ", "") for element in input_str.split(",")]  # Remove quotes/spaces
                for v in v_list:
                    vweburl += f"{key}[]={v}&"

        else:
            vapiurl = ""
            vweburl = ""

    if vweburl.endswith("&"):
        vweburl = vweburl[:-1]  # Remove trailing '&'
        vweburl = vweburl.replace("''", "").replace("\"\"", "")  # Remove any double quotes or empty quotes

    vapiurl = vapiurl.replace(", ", ",")
    logging.info(f"\nWeb URL: {vweburl}")
    
    vurl = ["test", "test2"]
    vurl[0] = vapiurl
    vurl[1] = vweburl
    return vurl

def validate_n_generate(vapiurl):
    try:
        url = vapiurl
        payload = {}
        headers = {}
        response = requests.request("GET", url, headers=headers, data=payload, timeout=30)
        response_text = response.text
        data = json.loads(response_text)
        return response_text

    except Exception as e:
        logging.error(f"\nURL validation error: {e}")
        return "error" + str(e)

def getVDQ(vtext):
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
        
        message = [{"role": "assistant", "content": gpt_assistant_prompt}, {"role": "user", "content": gpt_user_prompt}]
        response = openai.chat.completions.create(
            model="gpt-4-turbo",
            messages=message,
            temperature=0.1,
            frequency_penalty=0.0
        )

        return response.choices[0].message.content
    
    except Exception as e:
        logging.error(f"getVDQ error: {e}")
        return None

def summarize_conversation(conversation):
    llm = ChatOpenAI(model_name="gpt-3.5-turbo", temperature=0)
    
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

    summary = rag_chain.invoke(conversation)
    return summary

def generate_conversation_id():
    return str(uuid.uuid4())

def calculate_tokens(text, model_name="gpt-4o"):
    try:
        encoding = tiktoken.encoding_for_model(model_name)
        tokens = encoding.encode(text)
        return len(tokens)
    except Exception as e:
        logging.error(f"Token calculation error: {e}")
        return len(text.split())  # Fallback to word count

def update_conversation(conversation_id, response, response_token, response_URL):
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
            cursor.execute(update_query, (response, response_token, response_timestamp, response_URL, conversation_id))
            connection.commit()
    except Error as e:
        logging.error(f"MySQL update error: {e}")
    finally:
        if connection and connection.is_connected():
            cursor.close()
            connection.close()

def insert_conversation(conversation_id, request_token, request_timestamp, request, response, response_token, response_timestamp, context, followup_id, nlp_threshold, url, additional_info, exp):
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
            INSERT INTO conversations (conversation_id, request_token, request_timestamp, request, response, response_token, response_timestamp, context, followup_id, nlp_threshold, URL, additional_info, api_url)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """
            record = (conversation_id, request_token, request_timestamp, request, response, response_token, response_timestamp, context, followup_id, nlp_threshold, url, additional_info, exp)
            cursor.execute(sql_insert_query, record)
            connection.commit()
    except Error as e:
        logging.error(f"MySQL insert error: {e}")
    finally:
        if connection and connection.is_connected():
            cursor.close()
            connection.close()

def format_response(question):
    try:
        gpt_assistant_prompt = """You are AI Formatter. Convert the input into the following JSON format where any text that needs to be bold is prefixed with **:
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
        
        message = [{"role": "assistant", "content": gpt_assistant_prompt}, {"role": "user", "content": gpt_user_prompt}]
        response = openai.chat.completions.create(
            model="gpt-4o",
            messages=message,
            temperature=0.1,
            max_tokens=4096,
            frequency_penalty=0.0
        )

        return response
    except Exception as e:
        logging.error(f"Format response error: {e}")
        return None

def generate_answer(question, context, vchatbotname, vdealername):
    varchatbotname = vchatbotname
    vardealername = vdealername

    gpt_assistant_prompt = f"""
You are {varchatbotname}, a warm, friendly, and engaging professional AI sales assistant helping USA-based customers with automobile-related queries. 

🎯 **Main Goal:** Encourage the customer to **book an appointment or visit {vardealername}**. 

---

### Tone & Style
- Warm, conversational, and professional. Add light personality (😊, 🚗) without being over the top.  
- Use short replies: max 2–3 sentences.  
- Be positive and encouraging: "Great choice!", "Awesome!", "Got you covered!".  
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
     - "Would you like me to schedule a quick test drive?"  
     - "Want me to check financing or send trim options?"  

3. **Conversation Guidance:**  
   - Begin with a friendly greeting ("Hi there! 👋").  
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
     - Say: "{vardealername} is the best platform for purchasing a new or used vehicle. You can find vehicles near you, send a quick request to dealers, and they'll take care of the rest."  

---

### Response Quality
- Keep all responses short, engaging, and informative.  
- Always tie back to **the next step toward an appointment**.  
- Use {vardealername} naturally as the trusted dealership.  
- Stay within max token limits.  
"""
    try:
        if context:
            gpt_assistant_prompt += "\n previous chat history:  " + context
                           
        gpt_user_prompt = question 
        message = [{"role": "assistant", "content": gpt_assistant_prompt}, {"role": "user", "content": gpt_user_prompt}]
        response = openai.chat.completions.create(
            model="gpt-4o",
            messages=message,
            temperature=0.1,
            max_tokens=4096,
            frequency_penalty=0.0
        )
        return response
    except Exception as e:
        logging.error(f"Generate answer error: {e}")
        return None

def multilingual_process(question, detected_lang):
    try:
        if detected_lang == "":
            # Detect the language of the input
            detected_lang = detect(question)
            
            # Translate if the language is not English
            if detected_lang != 'en':
                question = GoogleTranslator(source=detected_lang, target='en').translate(question)
                return question, detected_lang
            else:
                return question, 'en'
        else:
            # Translate if the language is not English
            if detected_lang != 'en':
                question = GoogleTranslator(source='en', target=detected_lang).translate(question)
                return question, detected_lang
            else:
                return question, 'en'
    
    except LangDetectException:
        logging.error("Error detecting language.")
        return question, 'unknown'
    except Exception as e:
        logging.error(f"Translation error: {e}")
        return question, 'en'  # Return the original question if translation fails

@app.route('/process', methods=['POST'])
def process_request():
    # Get Body data from request
    data = request.json
    logging.info(f"\nFull payload received: {json.dumps(data, indent=2, default=str)}")
    
    question = data.get('request')
    context = data.get('context', "")
    logging.info(f"\nReceived question: {question}")
    logging.info(f"\nReceived context: {context}")
    detected_lang = ""

    context_tokens = 0
    vdealername = data.get('dealership_name', "")
    vchatbotname = data.get('chatbotname', "")
    vchatbotdealrurl = data.get('dealersouce', "")
    vuserid = data.get('userid', "")

    # Check if VIN number is given
    vin_pattern = r'(?<![A-HJ-NPR-Z0-9])[A-HJ-NPR-Z0-9]{17}(?![A-HJ-NPR-Z0-9])'
    vinflag = 0
    match = re.search(vin_pattern, question)
    logging.info(f"\nIs it a VIN no: {match}")

    # Check if its a new or follow-up call
    if context:
        conversation_id = data.get('conversation_id')
        followup_id = conversation_id
        context_tokens = calculate_tokens(context)
    else:
        followup_id = ""
        
    if not question:
        return jsonify({"error": "Request is required"}), 400
    
    conversation_id = data.get('conversation_id')
    
    request_timestamp = datetime.now()
    request_token = calculate_tokens(question)
    
    # Set and call NLP
    similarity = 0.6  # Default value if spaCy not available
    if nlp:
        assistant_prompt = "Automobile related information only"
        assistant_prompt_doc = nlp(assistant_prompt)
        api_response_doc = nlp(question)
        similarity = assistant_prompt_doc.similarity(api_response_doc)
    
    threshold = 0.50
    
    # Ensure the total tokens used is within model limits
    if context_tokens > 2000:  # Keeping a buffer to avoid hitting the limit               
        context = summarize_conversation(context)
        
    response_url = ""
    # Check threshold value
    if similarity > threshold:
        response_url = ""
    else:
        # Respond as not a related question
        response = "Question is not relevant to this platform."

    # Pass context if not a VIN related query
    if match is None:
        answer = generate_answer(question, context, vchatbotname, vdealername)
    else:
        answer = generate_answer(question, "", vchatbotname, vdealername)
        
    if not answer:
        return jsonify({"error": "Failed to generate answer"}), 500
        
    finalresponse = answer.choices[0].message.content       
    rawoutput = finalresponse.strip().replace("\n", "")
    startpos = rawoutput.find("How can I assist you")
    
    if startpos >= 0:
        finalresponse = ""
        response = rawoutput
        response_token = calculate_tokens(response)
        response_url = ""
        recordfound = "No"
        weburl = ""
        apiurl = ""
        vehicle = ""

        # Generate new conversation id for a new conversation
        if not conversation_id:
            conversation_id = generate_conversation_id()
            
        serialized_data = json.dumps(data)
        response = str(finalresponse)
        response_token = calculate_tokens(response)
        
        # Insert new conversation record in the database with a new conversation id
        insert_conversation(conversation_id, request_token, request_timestamp, serialized_data, finalresponse, response_token, request_timestamp, context, followup_id, similarity, response_url, json.dumps({"response": finalresponse}), "")

        # Return JSON response
        return jsonify({
            "conversation_id": conversation_id, 
            "response": finalresponse,
            "rawoutput": rawoutput,
            "recordFound": recordfound,
            "weburl": weburl,
            "vehicle": vehicle,
            "context": context,
            "apiurl": apiurl
        })
      
    else:
        if not conversation_id:
            conversation_id = generate_conversation_id()
            
        format_response_result = format_response(rawoutput)
        if not format_response_result:
            return jsonify({"error": "Failed to format response"}), 500
            
        finalresponse = format_response_result.choices[0].message.content
        finalresponse = finalresponse.strip().replace("\n", "")
        finalresponse = finalresponse.replace("```json", "")
        finalresponse = finalresponse.replace("```", "")
        
        logging.info(f"\nFinal Response: {finalresponse}")
        
        responselist = RAG(answer.choices[0].message.content, vchatbotname, vdealername, vchatbotdealrurl)
        response = str(responselist)
        response_token = calculate_tokens(response)
        serialized_data = json.dumps(data)
        response_url = responselist.get("weburl")
        dbresponse = str({
            "Message": responselist.get("message"),
            "recordFound": responselist.get("recordfound"),
            "weburl": responselist.get("weburl"),
            "context": context,
            "apiurl": responselist.get("apiurl")
        })
        
        logging.info(f"\nDB Response: {dbresponse}")
        insert_conversation(
            conversation_id, request_token, request_timestamp, serialized_data, 
            dbresponse, response_token, request_timestamp, context, followup_id, 
            similarity, response_url, json.dumps({"response": finalresponse}), 
            vuserid + " \n " + str(responselist.get("exception")) + "\n" + str(responselist.get("jsondata"))
        )
              
        if responselist.get("vehicle") == "No VIN Found":
            return jsonify({
                "Message": responselist.get("message"),
                "conversation_id": conversation_id, 
                "response": "",
                "rawoutput": rawoutput,
                "RecordFound": responselist.get("recordfound"),
                "weburl": responselist.get("weburl"),
                "vehicle": "",
                "context": context,
                "apiurl": responselist.get("apiurl")
            })
        else:
            return jsonify({
                "Message": responselist.get("message"),
                "conversation_id": conversation_id, 
                "response": finalresponse,
                "rawoutput": rawoutput,
                "RecordFound": responselist.get("recordfound"),
                "weburl": responselist.get("weburl"),
                "vehicle": responselist.get("vehicle"),
                "context": context,
                "apiurl": responselist.get("apiurl")
            })

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({"status": "healthy", "timestamp": datetime.now().isoformat()})

if __name__ == "__main__":
    app.run(debug=True, host='0.0.0.0', port=8000)