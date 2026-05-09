"""
LLM client for chat system - OpenRouter integration
"""
import os
import json
from typing import Optional
import openai

# System prompt - conversational scientific assistant
SYSTEM_PROMPT = """You are MitoSpace Chat, a friendly and precise scientific data assistant for mitochondrial microscopy analysis.

You are provided with COMPUTED STATISTICAL SUMMARIES from a real dataset of mitochondrial cells treated with various drugs (the v3 / 2025 dataset, ~36K cells across 26 drugs).

IMPORTANT CONTEXT:
- "Control" and "DMSO" refer to the same experimental condition (vehicle control). Treat them as one group "DMSO (control)".
- "Motility" in this dataset is measured as diffusivity, computed at three structural scales: Fragment, Segment, and Node. Plain "motility" without a qualifier means Fragment Motility (the canonical scale). When the user asks specifically about segment- or node-level motion, use Segment / Node Motility.
- TMRM intensity is reported at the LAST timepoint of a 20-frame time series — this represents the cell's membrane potential at the end of the imaging window.

FEATURE DISPLAY NAMES (always use these user-friendly names in your responses):
- "Fragment Diffusivity" / "fragment_diffusivity_mean" → "fragment motility"
- "Segment Diffusivity" / "segment_diffusivity_mean" → "segment motility"
- "Node Diffusivity" / "node_diffusivity_mean" → "node motility"
- "TMRM Intensity" / "tmrm_last" → "membrane potential"
- "MitoTracker Intensity" / "morph_last" → "mitochondrial mass"
- "Fragment Length" / "fragment_length_mean" → "fragment length" (mitochondrial fragmentation)
- "Segment Length" / "segment_length_mean" → "segment length" (network morphology)
- "Fragment Diameter" / "fragment_diameter_mean" → "fragment diameter"
- "Fragment Tortuosity" / "fragment_tortuosity_mean" → "tortuosity" (how curved the fragments are)
- "Fission Rate" / "fission_rate_mean" → "fission rate"
- "Fusion Rate" / "fusion_rate_mean" → "fusion rate"
- Never use the raw snake_case column names (e.g. "fragment_diffusivity_mean") in your responses.

RESPONSE STYLE:
1. Be conversational but scientifically precise — like a knowledgeable colleague
2. Use natural language, not bullet points (unless listing many items)
3. For drug rankings: list the top 5 drugs with their values, noting which are above/below control
4. For correlations: state the coefficient, interpretation, and what it means biologically
5. For comparisons: highlight the key differences and which drug had higher/lower values
6. Round numbers to 2-3 decimal places for readability
7. Keep responses concise: 2-5 sentences for simple queries, up to 6-8 for complex ones
8. If the user asks a follow-up, answer naturally without repeating context they already know

STRICT DATA RULES:
- Answer ONLY using the provided statistics — never invent numbers
- Do NOT speculate beyond the data
- If data is insufficient, say so clearly and suggest what they could ask instead
- Do not discuss UI controls or visualization features
"""


class LLMClient:
    """Wrapper for OpenRouter API calls (OpenAI-compatible)"""
    
    def __init__(self, api_key: Optional[str] = None, model: str = "openai/gpt-4o-mini"):
        """
        Initialize LLM client with OpenRouter
        
        Args:
            api_key: OpenRouter API key (or reads from OPENROUTER_API_KEY env var)
            model: Model to use via OpenRouter
                   Recommended:
                   - "openai/gpt-4o-mini" (excellent quality, cheap, ~$0.0002/query)
                   Other options:
                   - "openai/gpt-4o" (best quality, ~$0.003/query)
                   - "deepseek/deepseek-chat" (great value, ~$0.0004/query)
                   - "anthropic/claude-sonnet-4" (nuanced text, ~$0.004/query)
                   - "meta-llama/llama-3-70b-instruct" (cheapest, ~$0.0008/query)
        """
        self.api_key = api_key or os.getenv("OPENROUTER_API_KEY")
        if not self.api_key:
            raise ValueError(
                "OpenRouter API key not provided. Set OPENROUTER_API_KEY environment variable "
                "or pass api_key parameter."
            )
        
        self.model = model
        # OpenRouter uses OpenAI-compatible API with custom base URL
        self.client = openai.OpenAI(
            api_key=self.api_key,
            base_url="https://openrouter.ai/api/v1"
        )
    
    def generate_response(
        self,
        user_question: str,
        computed_stats: dict,
        query_type: str,
        temperature: float = 0.3,
        max_tokens: int = 500
    ) -> str:
        """
        Generate LLM response based on computed statistics
        
        Args:
            user_question: Original user question
            computed_stats: Dictionary of computed statistics
            query_type: Type of query (drug_comparison, correlation, etc.)
            temperature: Sampling temperature (lower = more deterministic)
            max_tokens: Maximum response length
        
        Returns:
            Generated response text
        """
        # Format computed stats as clean JSON for LLM
        stats_json = json.dumps(computed_stats, indent=2)
        
        # Construct user prompt with data
        user_prompt = f"""User question: "{user_question}"

Query type: {query_type}

Computed statistics from dataset:
```json
{stats_json}
```

Provide a clear, scientifically accurate answer using ONLY the statistics above.
Format your response as natural scientific text (not JSON).
"""
        
        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_prompt}
                ],
                temperature=temperature,
                max_tokens=max_tokens,
                timeout=30,  # 30 second timeout
                extra_headers={
                    "HTTP-Referer": "https://mitospace-explorer.app",  # Optional: for rankings
                    "X-Title": "MitoSpace Explorer"  # Optional: for rankings
                }
            )
            
            return response.choices[0].message.content.strip()
        
        except openai.APITimeoutError:
            return "Sorry, the response took too long. Please try again."
        
        except openai.RateLimitError:
            return "Rate limit exceeded. Please wait a moment and try again."
        
        except openai.APIError as e:
            print(f"[LLM] OpenRouter API error: {e}")
            return "Sorry, there was an error processing your question. Please try again."
        
        except Exception as e:
            print(f"[LLM] Unexpected error: {e}")
            return "Sorry, an unexpected error occurred. Please try again."


# Singleton instance (created at backend startup)
_llm_client: Optional[LLMClient] = None


def initialize_llm_client(api_key: Optional[str] = None, model: str = "openai/gpt-4o-mini"):
    """Initialize global LLM client at server startup"""
    global _llm_client
    try:
        _llm_client = LLMClient(api_key=api_key, model=model)
        print(f"[LLM] Initialized with OpenRouter model: {model}")
        return True
    except ValueError as e:
        print(f"[LLM] Warning: {e}")
        print("[LLM] Chat functionality will be disabled.")
        return False


def get_llm_client() -> Optional[LLMClient]:
    """Get global LLM client instance"""
    return _llm_client


def is_llm_available() -> bool:
    """Check if LLM client is available"""
    return _llm_client is not None
