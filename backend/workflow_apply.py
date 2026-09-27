"""
Применение адаптера к workflow.
Умеет:
  - подставлять значения в узлы по node_id / class_type / title
  - удалять ноду LoRA, если она не нужна, пробрасывая связи
"""
import copy


def find_by_meta(workflow: dict, class_type: str, title: str | None = None):
    if title is not None:
        for nid, node in workflow.items():
            if not isinstance(node, dict):
                continue
            if node.get("class_type") != class_type:
                continue
            actual = (node.get("_meta") or {}).get("title")
            if actual == title:
                return nid, node
        return None, None

    for nid, node in workflow.items():
        if isinstance(node, dict) and node.get("class_type") == class_type:
            return nid, node
    return None, None


def find_node(workflow: dict, spec: dict):
    nid = spec.get("node_id")
    if nid is not None:
        node = workflow.get(str(nid))
        if isinstance(node, dict) and node.get("class_type") == spec["class_type"]:
            return str(nid), node

    class_type = spec["class_type"]
    title = spec.get("title")
    if title is not None:
        for nid, node in workflow.items():
            if not isinstance(node, dict):
                continue
            if node.get("class_type") != class_type:
                continue
            actual = (node.get("_meta") or {}).get("title")
            if actual == title:
                return nid, node

    for nid, node in workflow.items():
        if isinstance(node, dict) and node.get("class_type") == class_type:
            return nid, node

    return None, None


def _bypass_node(workflow: dict, node_id: str, passthrough_input: str = "model") -> bool:
    """
    Удалить узел и заменить все ссылки на него ссылками на его вход.

    Пример: UNETLoader(#1) → LoRA(#5) → Sampling(#6)
    После bypass_node(wf, "5", "model"):
        UNETLoader(#1) → Sampling(#6)
    """
    node = workflow.get(node_id)
    if not isinstance(node, dict):
        return False

    source_link = node.get("inputs", {}).get(passthrough_input)
    if not isinstance(source_link, list) or len(source_link) < 1:
        return False

    # Заменить все ссылки на этот node_id
    for nid, n in workflow.items():
        if nid == node_id:
            continue
        if not isinstance(n, dict):
            continue
        inputs = n.get("inputs", {})
        for input_name, value in list(inputs.items()):
            if (isinstance(value, list) and len(value) >= 1
                    and str(value[0]) == str(node_id)):
                inputs[input_name] = list(source_link)

    # Удалить сам узел
    del workflow[node_id]
    return True


def apply_adapter(workflow: dict, adapter: dict, values: dict):
    wf = copy.deepcopy(workflow)
    mapping = adapter.get("mapping", {})
    applied, skipped = {}, []

    # --- Обычные поля (кроме LoRA) ---
    for key, val in values.items():
        if val is None:
            continue
        if key in ("lora_name", "lora_strength"):
            continue
        spec = mapping.get(key)
        if not spec:
            skipped.append(key)
            continue
        nid, node = find_node(wf, spec)
        if node is None:
            skipped.append(key)
            continue
        node["inputs"][spec["field"]] = val
        applied[key] = nid

    # --- LoRA ---
    lora_name_spec = mapping.get("lora_name")
    lora_strength_spec = mapping.get("lora_strength")

    if lora_name_spec:
        lora_name_value = values.get("lora_name", "")
        is_disabled = (not lora_name_value) or (not str(lora_name_value).strip())

        if is_disabled:
            # Удалить узел LoRA с проброской
            lora_id, lora_node = find_node(wf, lora_name_spec)
            if lora_node is not None:
                if _bypass_node(wf, str(lora_id), passthrough_input="model"):
                    applied["_lora_removed"] = lora_id
                elif lora_strength_spec:
                    # Фолбэк: strength = 0
                    snid, snode = find_node(wf, lora_strength_spec)
                    if snode is not None:
                        snode["inputs"][lora_strength_spec["field"]] = 0.0
                        applied["_lora_disabled"] = snid
        else:
            # Применяем имя
            nid, node = find_node(wf, lora_name_spec)
            if node is not None:
                node["inputs"][lora_name_spec["field"]] = lora_name_value
                applied["lora_name"] = nid

            # Применяем strength
            if lora_strength_spec and "lora_strength" in values:
                strength_val = values["lora_strength"]
                if strength_val is not None:
                    snid, snode = find_node(wf, lora_strength_spec)
                    if snode is not None:
                        snode["inputs"][lora_strength_spec["field"]] = float(strength_val)
                        applied["lora_strength"] = snid

    return wf, {"applied": applied, "skipped": skipped}
