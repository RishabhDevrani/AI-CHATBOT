from google import genai
from google.genai import errors
from dotenv import load_dotenv
from passlib.context import CryptContext
from fastapi import FastAPI, Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session
from database import engine,Base,SessionLocal
from jose import jwt
from fastapi.middleware.cors import CORSMiddleware
from datetime import datetime, timedelta
from pathlib import Path

import os
import models

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

SECRET_KEY = os.getenv("SECRET_KEY", "change-this-secret-key")
ALGORITHM = os.getenv("ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "60"))
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.7-flash")
GEMINI_FALLBACK_MODELS = [
    model.strip()
    for model in os.getenv("GEMINI_FALLBACK_MODELS", "gemini-2.5-flash,gemini-2.0-flash").split(",")
    if model.strip()
]
GEMINI_MODELS = list(dict.fromkeys([GEMINI_MODEL, *GEMINI_FALLBACK_MODELS]))

client = genai.Client(
    api_key=os.getenv("GEMINI_API_KEY")
)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
    "http://localhost:3000",
    "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

pwd_context = CryptContext(
    schemes=["bcrypt"],
    deprecated="auto"
)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

Base.metadata.create_all(bind=engine)

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/login")

def get_current_user(token: str = Depends(oauth2_scheme)):

    try:
        payload = jwt.decode(
            token,
            SECRET_KEY,
            algorithms=[ALGORITHM]
        )

        user_id = payload.get("user_id")

        if user_id is None:
            raise HTTPException(
                status_code=401,
                detail="Invalid token"
            )

        return user_id

    except Exception:
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired token"
        )

def generate_ai_content(contents):
    last_error = None

    for model_name in GEMINI_MODELS:
        try:
            return client.models.generate_content(
                model=model_name,
                contents=contents
            )
        except errors.APIError as exc:
            last_error = exc

            if getattr(exc, "status_code", None) in (401, 403):
                break
        except Exception as exc:
            last_error = exc
            break

    detail = "AI service is temporarily unavailable. Please try again in a moment."

    if last_error is not None:
        status_code = getattr(last_error, "status_code", None)
        if status_code:
            detail = f"{detail} Gemini returned status {status_code}."

    raise HTTPException(
        status_code=503,
        detail=detail
    )


# class ChatRequest(BaseModel):
#     message: str

class ChatRequest(BaseModel):
    conversation_id: int
    message: str

@app.get("/")
def home():
    try:
        with engine.connect() as connection:
            result = connection.execute(text("SELECT 1"))
            return {
                "message": "AI Chatbot Backend is Running",
                "database": "Connected"
            }
    except Exception as e:
        return {
            "database": "Not Connected",
            "error": str(e)
        }

@app.post("/api/chat")
def chat(
    request: ChatRequest,
    db: Session = Depends(get_db),
    current_user: int = Depends(get_current_user)
):
    # 1. Check conversation belongs to logged-in user
    conversation = db.query(models.Conversation).filter(
        models.Conversation.id == request.conversation_id,
        models.Conversation.user_id == current_user
    ).first()

    if not conversation:
        raise HTTPException(
            status_code=404,
            detail="Conversation not found"
        )

    # 2. Save user's new message
    user_message = models.Message(
        conversation_id=request.conversation_id,
        role="user",
        content=request.message
    )

    db.add(user_message)
    db.flush()

    # 3. Get previous conversation messages
    previous_messages = db.query(models.Message).filter(
        models.Message.conversation_id == request.conversation_id
    ).order_by(models.Message.id.asc()).all()

    # 4. Convert database messages into Gemini format
    contents = []

    for message in previous_messages:
        if message.role == "user":
            contents.append({
                "role": "user",
                "parts": [
                    {"text": message.content}
                ]
            })

        elif message.role == "assistant":
            contents.append({
                "role": "model",
                "parts": [
                    {"text": message.content}
                ]
            })

    # 5. Send complete conversation to Gemini
    try:
        response = generate_ai_content(contents)
    except HTTPException:
        db.rollback()
        raise

    ai_reply = response.text

    # 6. Save AI response
    ai_message = models.Message(
        conversation_id=request.conversation_id,
        role="assistant",
        content=ai_reply
    )

    db.add(ai_message)
    db.commit()

    # 7. Return response
    return {
        "user_message": request.message,
        "reply": ai_reply
    }

class UserCreate(BaseModel):
    name: str
    email: str
    password: str

@app.post("/api/register")
def register(user: UserCreate, db: Session = Depends(get_db)):

    hashed_password=pwd_context.hash(user.password)

    new_user = models.User(
        name=user.name,
        email=user.email,
        password=hashed_password
    )

    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    return {
        "message": "User registered successfully",
        "user_id": new_user.id
    }

class UserLogin(BaseModel):
    email: str
    password: str

@app.post("/api/login")
def login(user: UserLogin, db: Session = Depends(get_db)):

    db_user = db.query(models.User).filter(
        models.User.email == user.email
    ).first()

    if not db_user:
        return {
            "message": "Invalid email or password"
        }

    if not pwd_context.verify(user.password, db_user.password):
        return {
            "message": "Invalid email or password"
        }

    # JWT token create
    expire = datetime.utcnow() + timedelta(
        minutes=ACCESS_TOKEN_EXPIRE_MINUTES
    )

    token_data = {
        "user_id": db_user.id,
        "email": db_user.email,
        "exp": expire
    }

    access_token = jwt.encode(
        token_data,
        SECRET_KEY,
        algorithm=ALGORITHM
    )

    return {
        "message": "Login successful",
        "access_token": access_token,
        "token_type": "bearer",
        "user_id": db_user.id,
        "name": db_user.name
    }

class ConversationCreate(BaseModel):
    title: str

@app.post("/api/conversations")
def create_conversation(
    conversation: ConversationCreate,
    db: Session = Depends(get_db),
    current_user: int = Depends(get_current_user)
):
    new_conversation = models.Conversation(
        user_id=current_user,
        title=conversation.title
    )

    db.add(new_conversation)
    db.commit()
    db.refresh(new_conversation)

    return {
        "message": "Conversation created successfully",
        "conversation_id": new_conversation.id,
        "title": new_conversation.title
    }


@app.get("/api/test-ai")
def test_ai():
    response = generate_ai_content("Say hello in one short sentence.")

    return {
        "reply": response.text
    }

# @app.get("/api/conversations/{conversation_id}/messages")
# def get_messages(
#     conversation_id: int,
#     db: Session = Depends(get_db)
# ):
#     messages = db.query(models.Message).filter(
#         models.Message.conversation_id == conversation_id
#     ).order_by(models.Message.id.asc()).all()

#     return [
#         {
#             "role": message.role,
#             "content": message.content
#         }
#         for message in messages
#     ]

@app.get("/api/users/{user_id}/conversations")
def get_conversations(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: int = Depends(get_current_user)
):
    if user_id != current_user:
        raise HTTPException(
            status_code=403,
            detail="You are not authorized to access this user's conversations"
        )

    conversations = db.query(models.Conversation).filter(
        models.Conversation.user_id == user_id
    ).order_by(models.Conversation.id.desc()).all()

    return [
        {
            "id": conversation.id,
            "title": conversation.title
        }
        for conversation in conversations
    ]

@app.get("/api/conversations/{conversation_id}/messages")
def get_messages(
    conversation_id: int,
    db: Session = Depends(get_db),
    current_user: int = Depends(get_current_user)
):
    conversation = db.query(models.Conversation).filter(
        models.Conversation.id == conversation_id,
        models.Conversation.user_id == current_user
    ).first()

    if not conversation:
        raise HTTPException(
            status_code=404,
            detail="Conversation not found"
        )

    messages = db.query(models.Message).filter(
        models.Message.conversation_id == conversation_id
    ).order_by(models.Message.id.asc()).all()

    return [
        {
            "role": message.role,
            "content": message.content
        }
        for message in messages
    ]

@app.delete("/api/conversations/{conversation_id}")
def delete_conversation(
    conversation_id: int,
    db: Session = Depends(get_db),
    current_user: int = Depends(get_current_user)
):
    conversation = db.query(models.Conversation).filter(
        models.Conversation.id == conversation_id,
        models.Conversation.user_id == current_user
    ).first()

    if not conversation:
        raise HTTPException(
            status_code=404,
            detail="Conversation not found"
        )

    db.query(models.Message).filter(
        models.Message.conversation_id == conversation_id
    ).delete(synchronize_session=False)

    db.delete(conversation)
    db.commit()

    return {
        "message": "Conversation deleted successfully",
        "conversation_id": conversation_id
    }
